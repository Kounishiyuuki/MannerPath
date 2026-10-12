#!/usr/bin/env python3
"""Fail-closed policy for the repository's CI (Python + system Ruby/Psych, no gems).

This audits workflow structure, not arbitrary program behavior. PR review and protected
checks remain necessary: a contributor can edit this checker in the same PR.
"""
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
APPROVED_ACTIONS = frozenset({
    'actions/checkout', 'actions/setup-node', 'actions/upload-artifact',
    'actions/configure-pages', 'actions/deploy-pages',
})
FORBIDDEN_EVENTS = frozenset({'pull_request_target', 'workflow_run', 'issue_comment'})
CI_NODE_VERSION = '24.21.0'
PAGES_PACKAGE_COMMAND = 'python3 scripts/package-pages-artifact.py --site site --output "$RUNNER_TEMP/artifact.tar"'


def image_is_pinned(config):
    image = config.get('image') if isinstance(config, dict) else config
    return isinstance(image, str) and bool(re.fullmatch(r'[^\s@]+@sha256:[0-9a-f]{64}', image))

# Parse YAML nodes, preserving scalar spelling (not YAML 1.1's on -> true conversion).
# Reject duplicate keys, aliases and custom tags instead of silently guessing intent.
YAML_PARSER = r'''
require 'yaml'
require 'json'
def decode(n)
  raise 'tags are not supported' if n.respond_to?(:tag) && n.tag
  case n
  when Psych::Nodes::Stream
    raise 'one YAML document required' unless n.children.length == 1
    decode(n.children.first)
  when Psych::Nodes::Document
    decode(n.children.first)
  when Psych::Nodes::Mapping
    h = {}
    n.children.each_slice(2) do |k,v|
      raise 'scalar mapping keys required' unless k.is_a?(Psych::Nodes::Scalar)
      key = decode(k)
      raise 'duplicate or merge key' if h.key?(key) || key == '<<'
      h[key] = decode(v)
    end
    h
  when Psych::Nodes::Sequence
    n.children.map { |v| decode(v) }
  when Psych::Nodes::Scalar
    n.value
  else
    raise 'aliases or unsupported YAML nodes'
  end
end
puts JSON.generate(decode(Psych.parse_stream(STDIN.read)))
'''


def parse_yaml(text):
    result = subprocess.run(['ruby', '-e', YAML_PARSER], input=text, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        raise ValueError('invalid, ambiguous or unsupported YAML')
    return json.loads(result.stdout)


def strings(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)
    elif isinstance(value, str):
        yield value


def workflow_errors(doc, filename):
    errors = []
    def reject(condition, reason):
        if condition:
            errors.append(reason)
    if not isinstance(doc, dict):
        return ['workflow must be a mapping']
    events = doc.get('on', {})
    if isinstance(events, str):
        events = {events: ''}
    elif isinstance(events, list):
        events = dict.fromkeys(events, '')
    reject(not isinstance(events, dict), 'invalid events')
    if not isinstance(events, dict):
        events = {}
    for event in sorted(FORBIDDEN_EVENTS & set(events)):
        errors.append(f'{event} forbidden')
    # Dispatch/call are not blanket-banned: only read-only jobs may use them.
    # The Pages write exception below admits only main push/manual dispatch.
    call = events.get('workflow_call')
    reject(isinstance(call, dict) and 'secrets' in call, 'workflow_call secret declarations forbidden')
    reject(doc.get('permissions') != {'contents': 'read'}, 'default permissions must be contents: read')
    reject(any(re.search(r'\bsecrets\b|\bgithub\s*(?:\.\s*token\b|\[\s*[\'"]token[\'"]\s*\])|\btoJSON\s*\(\s*github\s*\)' , s, re.I)
               for s in strings(doc)), 'secrets/token references forbidden in these workflows')
    jobs = doc.get('jobs', {})
    if not isinstance(jobs, dict) or not jobs:
        return errors + ['jobs mapping required']
    for job_id, job in jobs.items():
        if not isinstance(job, dict):
            errors.append('invalid job')
            continue
        privileged_pages = filename == 'pages.yml' and job_id == 'deploy'
        perms = job.get('permissions', doc.get('permissions'))
        expected = {'contents': 'read', 'pages': 'write', 'id-token': 'write'} if privileged_pages else {'contents': 'read'}
        reject(perms != expected, f'{job_id}: excessive or ambiguous permissions')
        if privileged_pages:
            reject(set(events) != {'push', 'workflow_dispatch'}, 'Pages triggers must be push/dispatch only')
            reject(not isinstance(events.get('push'), dict) or events['push'].get('branches') != ['main'], 'Pages push must target main only')
            reject(job.get('if') != "github.ref == 'refs/heads/main'", 'Pages must guard dispatches to main')
            reject(job.get('environment', {}).get('name') != 'github-pages', 'Pages environment required')
            reject(job.get('needs') != 'build', 'Pages must deploy the read-only build artifact')
        reject('secrets' in job, 'reusable secrets forbidden')
        # No opaque reusable jobs: this checker audits every executed step here.
        reject('uses' in job, 'reusable jobs require a separate security policy')
        runner = job.get('runs-on', '')
        reject(not isinstance(runner, str) or not re.fullmatch(r'(ubuntu|macos|windows)-(latest|[0-9]+(?:\.[0-9]+)?)', runner), 'GitHub-hosted literal runner required')
        if 'container' in job:
            reject(not image_is_pinned(job['container']), 'container image must use sha256 digest')
        services = job.get('services', {})
        reject(not isinstance(services, dict), 'services must be a mapping')
        if isinstance(services, dict):
            for service in services.values():
                reject(not image_is_pinned(service), 'service image must use sha256 digest')
        steps = job.get('steps', [])
        if not isinstance(steps, list):
            errors.append('steps must be a list')
            continue
        for step in steps:
            if not isinstance(step, dict):
                errors.append('step must be a mapping')
                continue
            action = step.get('uses')
            if action is not None:
                reject(not isinstance(action, str) or not re.fullmatch(r'[\w.-]+/[\w./-]+@[0-9a-f]{40}', action), 'action must use a full commit SHA')
                reject(not isinstance(action, str) or action.split('@')[0] not in APPROVED_ACTIONS, 'action repository is not approved')
                if isinstance(action, str) and action.startswith('actions/setup-node@'):
                    reject(step.get('with', {}).get('node-version') != CI_NODE_VERSION, 'CI Node must use the reviewed patch version')
                if isinstance(action, str) and action.lower().startswith('actions/checkout@'):
                    options = step.get('with', {})
                    reject(not isinstance(options, dict) or str(options.get('persist-credentials')).lower() != 'false', 'checkout must set persist-credentials: false')
                    reject('ref' in options or 'repository' in options, 'checkout must use the default event ref/repository')
                if privileged_pages:
                    reject(not isinstance(action, str) or action.split('@')[0] not in {
                        'actions/configure-pages', 'actions/deploy-pages'}, 'unexpected action in privileged Pages job')
            run = step.get('run', '')
            reject(not isinstance(run, str), 'run must be literal text')
            if isinstance(run, str):
                reject('${{' in run, 'expressions in run forbidden; use quoted environment variables')
                reject(bool(re.search(r'\b(?:echo|printf|printenv|env|set\s+-x)\b', run)) and bool(re.search(r'\$(?:\{)?[\w]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY|ACCESS_KEY|AUTHORIZATION)[\w]*', run, re.I)), 'credential output forbidden')
                reject(bool(re.search(r'\bnpm\s+ci\b', run)) and run.strip() != 'npm ci --ignore-scripts', 'npm ci must disable lifecycle scripts')
                reject(privileged_pages and bool(run), 'privileged Pages job must not run repository shell code')
    if filename == 'pages.yml':
        build = jobs.get('build', {})
        reject(build.get('if') != "github.ref == 'refs/heads/main'", 'Pages build must target main')
        reject(any(k in doc or k in build for k in ('defaults', 'env')), 'Pages packaging must use the default command environment')
        packages = [s for s in build.get('steps', []) if isinstance(s, dict) and 'run' in s]
        reject(len(packages) != 1 or any(s.get('run') != PAGES_PACKAGE_COMMAND or any(k in s for k in ('shell', 'env', 'working-directory', 'if', 'continue-on-error')) for s in packages), 'Pages must run the permission-normalizing packager')
        uploads = [s for s in build.get('steps', []) if isinstance(s, dict) and str(s.get('uses', '')).startswith('actions/upload-artifact@')]
        reject(len(uploads) != 1 or uploads[0].get('with', {}).get('name') != 'github-pages' or uploads[0].get('with', {}).get('path') != '${{ runner.temp }}/artifact.tar', 'Pages must upload the normalized archive')
    if filename == 'pr-validation.yml':
        reject('pull_request' not in events or events.get('pull_request') not in ('', None, {}), 'all PRs must run without trigger filters')
        job = jobs.get('validate', {})
        reject(bool(job.get('if')) or bool(job.get('continue-on-error')), 'PR validation job cannot skip or tolerate failure')
        reject('defaults' in doc or 'defaults' in job, 'PR checks must run from the repository root')
        reject('env' in doc or 'env' in job, 'PR validation must not override the command environment')
        for command in ('make contract', 'make api-validate', 'make security-validate'):
            steps = [s for s in job.get('steps', []) if isinstance(s, dict) and s.get('run') == command]
            reject(len(steps) != 1 or any(s.get('if') not in (None, 'always()') or s.get('continue-on-error') or any(k in s for k in ('working-directory', 'shell', 'env')) for s in steps), f'required check missing/skippable: {command}')
        nodes = [s for s in job.get('steps', []) if isinstance(s, dict) and str(s.get('uses', '')).startswith('actions/setup-node@')]
        reject(len(nodes) != 1, 'PR must install the reviewed Node patch')
        checkouts = [s for s in job.get('steps', []) if isinstance(s, dict) and str(s.get('uses', '')).startswith('actions/checkout@')]
        reject(len(checkouts) != 1 or str(checkouts[0].get('with', {}).get('fetch-depth')) != '0', 'full history checkout required')
    return errors


def dependency_errors(root):
    errors = []
    package = json.loads((root / 'services/api/package.json').read_text())
    lock = json.loads((root / 'services/api/package-lock.json').read_text())
    for group in ('dependencies', 'devDependencies'):
        pins = package.get(group, {})
        if lock['packages'][''].get(group, {}) != pins:
            errors.append(f'lock root differs from {group}')
        for name, version in pins.items():
            exact = re.fullmatch(r'\d+\.\d+\.\d+(?:-[\w.-]+)?', version)
            sheetjs = name == 'xlsx' and re.fullmatch(r'https://cdn\.sheetjs\.com/xlsx-\d+\.\d+\.\d+/xlsx-\d+\.\d+\.\d+\.tgz', version)
            if not (exact or sheetjs):
                errors.append(f'non-exact dependency: {name}')
    for name, entry in lock['packages'].items():
        if name and not entry.get('integrity'):
            errors.append(f'missing lock integrity: {name}')
        if entry.get('hasInstallScript') and name not in {'node_modules/esbuild', 'node_modules/workerd', 'node_modules/fsevents'}:
            errors.append(f'unreviewed lifecycle script: {name}')
    return errors


def main():
    errors = []
    paths = sorted((ROOT / '.github/workflows').glob('*.yml')) + sorted((ROOT / '.github/workflows').glob('*.yaml'))
    if not any(p.name == 'pr-validation.yml' for p in paths):
        errors.append('PR validation workflow missing')
    for path in paths:
        try:
            errors.extend(f'{path.name}: {e}' for e in workflow_errors(parse_yaml(path.read_text()), path.name))
        except (ValueError, OSError, TypeError, AttributeError) as exc:
            errors.append(f'{path.name}: parse/policy failure ({type(exc).__name__})')
    try:
        config = parse_yaml((ROOT / '.github/dependabot.yml').read_text())
        pairs = {(u['package-ecosystem'], u['directory']) for u in config['updates']}
        if config.get('version') != '2' or pairs != {('github-actions', '/'), ('npm', '/services/api')}:
            errors.append('Dependabot must cover Actions and API npm')
        errors.extend(dependency_errors(ROOT))
    except (ValueError, OSError, KeyError, TypeError) as exc:
        errors.append(f'dependency policy failure ({type(exc).__name__})')
    for error in errors:
        print(error, file=sys.stderr)
    if not errors:
        print(f'CI security policy: {len(paths)} workflows and dependency configuration PASS')
    return int(bool(errors))


if __name__ == '__main__':
    sys.exit(main())
