#!/usr/bin/env python3
"""Negative tests for workflow trust boundaries; no network or credentials."""
import copy
import importlib.util
import unittest
import tempfile
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('ci_security', ROOT / 'scripts/check-ci-security.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class CiSecurityTests(unittest.TestCase):
    def setUp(self):
        self.doc = guard.parse_yaml((ROOT / '.github/workflows/pr-validation.yml').read_text())

    def rejects(self, mutate, reason):
        doc = copy.deepcopy(self.doc)
        mutate(doc)
        self.assertTrue(any(reason in e for e in guard.workflow_errors(doc, 'pr-validation.yml')))

    def test_current_workflows(self):
        for path in (ROOT / '.github/workflows').glob('*.yml'):
            with self.subTest(path=path.name):
                self.assertEqual(guard.workflow_errors(guard.parse_yaml(path.read_text()), path.name), [])

    def test_permissions_top_and_job(self):
        for permissions in ('write-all', {'contents': 'write'}, {'contents': 'read', 'id-token': 'write'}):
            with self.subTest(permissions=permissions):
                self.rejects(lambda d: d.update(permissions=permissions), 'permissions')
                self.rejects(lambda d: d['jobs']['validate'].update(permissions=permissions), 'permissions')

    def test_privileged_event_all_yaml_forms(self):
        for events in ('pull_request_target', ['pull_request_target'], {'pull_request_target': ''}):
            self.rejects(lambda d: d.update(on=events), 'pull_request_target')

    def test_action_tags_branches_short_shas_and_docker(self):
        for action in ('actions/checkout@v4', 'vendor/action@main', 'vendor/action@abc123', 'docker://image:latest'):
            self.rejects(lambda d: d['jobs']['validate']['steps'][0].update(uses=action), 'full commit SHA')

    def test_checkout_credentials_and_ref(self):
        for value in ('true', True, '${{ inputs.persist }}'):
            self.rejects(lambda d: d['jobs']['validate']['steps'][0]['with'].update({'persist-credentials': value}), 'persist-credentials')
        for key, value in (('ref', '${{ github.event.pull_request.head.sha }}'), ('repository', '${{ github.event.pull_request.head.repo.full_name }}')):
            self.rejects(lambda d: d['jobs']['validate']['steps'][0]['with'].update({key: value}), 'default event ref')
        self.rejects(lambda d: d['jobs']['validate']['steps'][0]['with'].pop('persist-credentials'), 'persist-credentials')

    def test_secret_output_direct_and_via_environment(self):
        self.rejects(lambda d: d['jobs']['validate']['steps'].append({'run': 'echo "${{ secrets.EXAMPLE }}"'}), 'secrets/token')
        self.rejects(lambda d: d['jobs']['validate']['steps'].append({'env': {'VALUE': "${{ secrets['EXAMPLE'] }}"}, 'run': 'printf "%s" "$VALUE"'}), 'secrets/token')
        for variable in ('AUTH_TOKEN', 'API_KEY', 'PRIVATE_KEY', 'PASSWORD'):
            self.rejects(lambda d: d['jobs']['validate']['steps'].append({'run': f'echo "${variable}"'}), 'credential output')
        self.rejects(lambda d: d['jobs']['validate'].update(secrets='inherit'), 'reusable secrets')
        for expression in ("${{ github['token'] }}", '${{ github["token"] }}', '${{ toJSON(secrets) }}', '${{ toJSON(github) }}'):
            self.rejects(lambda d: d['jobs']['validate']['steps'].append({'env': {'VALUE': expression}, 'run': 'echo "$VALUE"'}), 'secrets/token')

    def test_shell_injection(self):
        self.rejects(lambda d: d['jobs']['validate']['steps'].append({'run': 'echo "${{ github.event.pull_request.title }}"'}), 'expressions in run')

    def test_required_checks_cannot_skip(self):
        for key, value in (('if', 'false'), ('continue-on-error', 'true'), ('working-directory', 'other'), ('shell', 'bash -c true {0}'), ('env', {'MAKEFLAGS': '-n'})):
            self.rejects(lambda d: d['jobs']['validate']['steps'][3].update({key: value}), 'required check')
        self.rejects(lambda d: d['on'].update(pull_request={'paths': ['services/**']}), 'all PRs')
        self.rejects(lambda d: d['jobs']['validate']['steps'][0]['with'].update({'fetch-depth': '1'}), 'full history')
        self.rejects(lambda d: d['jobs']['validate'].update({'runs-on': 'self-hosted'}), 'hosted literal')
        for command in ('npm ci', 'npm ci --ignore-scripts=false', 'npm ci --ignore-scripts --ignore-scripts=false', 'npm ci --ignore-scripts --no-ignore-scripts'):
            self.rejects(lambda d: d['jobs']['validate']['steps'][2].update(run=command), 'lifecycle scripts')
        self.rejects(lambda d: d.update(env={'MAKEFLAGS': '-n'}), 'command environment')
        self.rejects(lambda d: d['jobs']['validate'].update(env={'MAKEFLAGS': '-n'}), 'command environment')

    def test_pages_permission_exception_is_narrow(self):
        doc = guard.parse_yaml((ROOT / '.github/workflows/pages.yml').read_text())
        for mutate in (lambda d: d['jobs']['deploy'].pop('if'),
                       lambda d: d['on'].update(pull_request=''),
                       lambda d: d['jobs']['deploy']['steps'].append({'run': 'make contract'}),
                       lambda d: d['jobs']['deploy']['permissions'].update({'contents': 'write'}),
                       lambda d: d['jobs']['build'].update(permissions={'contents': 'read', 'id-token': 'write'}),
                       lambda d: d['jobs']['deploy'].pop('needs')):
            changed = copy.deepcopy(doc)
            mutate(changed)
            self.assertTrue(guard.workflow_errors(changed, 'pages.yml'))

    def test_yaml_ambiguities_fail_closed(self):
        for text in ('permissions: read-all\npermissions: write-all\n', 'a: &x [one]\nb: *x\n', 'a: [', '---\na: b\n---\na: c\n', 'a: !custom value\n'):
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    guard.parse_yaml(text)
        self.assertIn('on', guard.parse_yaml('on:\n  pull_request:\n'))

    def test_dependency_pins_and_lock_match(self):
        self.assertEqual(guard.dependency_errors(ROOT), [])
        mutations = (
            lambda package, lock: package['dependencies'].update(hono='^4.13.8'),
            lambda package, lock: lock['packages']['node_modules/hono'].pop('integrity'),
            lambda package, lock: lock['packages']['node_modules/hono'].update(hasInstallScript=True),
        )
        for mutate in mutations:
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                api = root / 'services/api'
                api.mkdir(parents=True)
                package = json.loads((ROOT / 'services/api/package.json').read_text())
                lock = json.loads((ROOT / 'services/api/package-lock.json').read_text())
                mutate(package, lock)
                (api / 'package.json').write_text(json.dumps(package))
                (api / 'package-lock.json').write_text(json.dumps(lock))
                self.assertTrue(guard.dependency_errors(root))


if __name__ == '__main__':
    unittest.main()
