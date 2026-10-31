# CI / GitHub / supply-chain hardening

Lane 2 baseline: `ae63660200f12af30351420b0bd6016973b59fd9` (2026-10-12).
This document specifies repository controls and maintainer account actions. It does not
assert that GitHub settings have been enabled, that a hosted workflow has run, or that
production/App Store release is approved. No deployment or account changes are part of this lane.

## PR checks and trust boundary

`.github/workflows/pr-validation.yml` runs on **every pull request**, without path/branch
filters, and on main pushes. Node **24.21.0** runs `make contract`, `make api-validate` and
`make security-validate`. The single stable required-check candidate is **PR validation**;
confirm its exact check-run name and GitHub Actions source after the first real hosted run.
macOS 15 is intentional: an existing security test parses the Xcode project with `plutil`.
Python 3 and the runner's system Ruby/Psych parse workflow YAML; no additional parser package
or gem is downloaded. Workflow guards reject duplicate keys, aliases, custom tags and multiple
YAML documents rather than accepting ambiguous security configuration.

PR code is untrusted even when it is the merge ref. The workflow uses `pull_request`, never
`pull_request_target`, read-only contents permissions, GitHub-hosted disposable runners,
default checkout ref/repository and `persist-credentials: false`. There are no secret
references, environment credentials, deployment actions or PR-supplied expressions in shell
commands. Full checkout history is required for the reachable-history secret scan. Fork and
Dependabot PRs need no secrets. A maintainer may still need to approve a first-time fork's run;
this must not become permission to expose credentials or bypass required checks.

`make security-validate` includes the YAML/dependency policy checker and negative tests.
It rejects write-all, elevated PR permissions, `pull_request_target` / `workflow_run` /
`issue_comment`, unapproved action repositories, tag-only actions, mutable container/service
images, floating Node versions, persisted
checkout credentials, explicit checkout refs/repositories, secret/token references, shell
expression interpolation, filtered/skippable required checks and newly introduced unreviewed
npm lifecycle-script packages. Its sole privileged exception is the existing Pages deploy job:
main-only push/dispatch, `github-pages` environment, official SHA-pinned configure/deploy actions and no
repository shell code. Packaging/upload runs in a separate read-only build job. Pages write/OIDC scopes are job-local; workflow defaults stay read-only.
The checker is a structural policy, not a general shell taint analyzer or a proof that arbitrary
PR code cannot communicate over the network. Protected checks and human review remain necessary;
a PR can edit the checker itself.

## Action pin inventory

The former tag-only references were all in `pages.yml`; the source-health workflow was already
SHA-pinned. The following pins were resolved from official repositories, not third-party snippets.
The 2026-10-31 dependency review updates checkout to v7.0.1, configure-pages to v6.0.0,
upload-artifact to v7.0.2 and deploy-pages to v5.0.1. Each official release tag was resolved to the
full commit below and its `action.yml` reviewed at that commit; all four use Node 24.
The former composite upload wrapper remains removed because its nested mutable Action reference
would escape the top-level SHA policy. The build job uses `scripts/package-pages-artifact.py` to
create `artifact.tar` and uploads it directly with the reviewed upload-artifact SHA. The deploy job depends on that
build and retains the same `github-pages` artifact/environment contract.

The artifact builder records directories as 755 and regular files as 644, with zero timestamps
and uid/gid and no host extended attributes. It does not chmod the source. All symbolic links
(including links within site), special files and unsafe path components are refused; hard-linked
regular inputs become independent regular archive entries. Directory-relative no-follow opens
prevent a path swap from dereferencing a symlink. A failed build leaves no partial archive;
CI stops before upload. Actual site HTML/CSS files require no executable bits. Artifact tests
exercise the real site, world-writable/executable fixtures, links, special files and traversal
names. The packaging script is included in Pages push path filters so fixes regenerate Pages.

Action approval is repository-specific, not an owner wildcard: only `actions/checkout`,
`actions/setup-node`, `actions/upload-artifact`, `actions/configure-pages` and
`actions/deploy-pages` are allowed, each at a full SHA. New actions need an explicit review
and policy change. `container` / `services` images require `image@sha256:<64 lowercase hex>`;
there are no such images in current workflows. A digest prevents a mutable tag update, but
new image contents and runner compatibility still require review.

Trigger decisions (2026-10-13):

| Trigger | Policy / current use |
| --- | --- |
| pull_request_target, workflow_run, issue_comment | Forbidden in every workflow, regardless of permission declarations |
| workflow_dispatch | Retained for source-health (read-only) and Pages (main-only, environment-gated write job with no checkout/shell) |
| repository_dispatch | Not currently used; allowed only within the general read-only, secret-free, default-ref checkout policy; the Pages write exception excludes it |
| workflow_call | Not currently used; same read-only policy, no secret declarations or inheritance; the Pages write exception excludes it |

The Node patch is fixed to 24.21.0 in PR validation and source-health, matching the tested
local runtime and API `engines.node >=24`. Updating Node requires an explicit reviewed change;
no automatic Node updater is added. Current Pages comments were checked against official
upstream tags: configure-pages v6.0.0 and deploy-pages v5.0.1. This Action runtime is separate
from the Node version selected for API scripts by setup-node.

| Action | Current version | Commit |
| --- | --- | --- |
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/configure-pages | v6.0.0 | `45bfe0192ca1faeb007ade9deae92b16b8254a0d` |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| actions/deploy-pages | v5.0.1 | `368f82528645a54fb793d4d04e342629a3f51346` |
| actions/setup-node | v7.1.0 (unchanged) | `949feb2413d6458794dcd2491c4babbbce0c15c1` |

Checkout's Node 24 runtime needs Actions Runner >=2.327.1; authenticated Git from a Docker
container with its v6+ credential storage needs >=2.329.0. This repository uses GitHub-hosted
macOS 15 and Ubuntu runners, `persist-credentials: false`, no container-authenticated Git, and
no unsafe PR checkout override. The existing ban on `pull_request_target`/`workflow_run` remains.
See [official checkout requirements](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/README.md)
and [GitHub's Node 20 retirement notice](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/).

Upload-artifact v7 introduces direct uploads, but `archive: false` ignores `name` and uses the
uploaded filename as the artifact name. Pages therefore explicitly keeps **`archive: true`**,
`name: github-pages` and a single `artifact.tar` in the ZIP. Direct upload would rename it to
`artifact.tar` and break deploy-pages' `artifact_name: github-pages` default. Source-health also
explicitly keeps ZIP mode for its multi-file report. See the [pinned upload inputs](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml).

PR validation adds a separate Ubuntu **Pages artifact validation (no deploy)** job: checkout,
the same packager, and upload of a one-day ZIP named `pages-validation`. It has read-only
contents permission, no Pages environment/OIDC/write scopes, and no configure/deploy Action.
The policy rejects changing its artifact to `github-pages`, disabling ZIP mode, bypassing the
packager or making it a privileged/conditional deployment job. It runs on PRs and main pushes;
it cannot publish Pages. Required-check selection remains a maintainer account setting.
The original **PR validation** check remains the stable required-check candidate and may not
depend on another job: an artifact failure must not turn API/security validation into a skipped
check. Both jobs run independently; their successful checks should be reviewed before merging.

Changing `pages.yml` will trigger the existing production Pages workflow **when a maintainer
later merges to main** and republish unchanged `site/`. Branch pushes/PR validation do not
run that workflow. No workflow dispatch, Pages configuration change or deployment is part of
this verification. Hosted configure/deploy behavior needs a separately authorized deployment.

Dependabot checks Actions weekly and opens reviewable update PRs; it does not approve or
merge them. Review official tags, implementation and runner requirements before accepting
new SHAs. A pin prevents tag mutation, not malicious code at a reviewed commit.

## Dependency policy

API npm dependencies remain unchanged: exact direct versions and a committed lockfile with
integrity hashes. The reviewed non-registry exception is the versioned SheetJS HTTPS tarball,
whose lock integrity must remain intact. Dependabot npm updates target `/services/api`, weekly,
with `versioning-strategy: increase`; verify exact versions and peer compatibility in each PR.
Do not enable auto-merge or use an unreviewed `npm audit fix --force`.

CI installs using `npm ci --ignore-scripts`. The current lock marks esbuild, workerd and
macOS-only fsevents as having lifecycle scripts; the guard rejects additional script-bearing
packages until reviewed. Disabling lifecycle scripts does not stop code running later during
tests. Platform optional binaries must be present: a clean install followed by API validation
is the verification, not the absence of install output. Never globally re-enable scripts just
to fix an unavailable binary; review a scoped alternative first.

Swift has an Xcode project, no `Package.swift` manifest. GRDB.swift is exact version 7.9.0,
with revision `aa0079aeb82a4bf00324561a40bffe68c6fe1c26` in committed `Package.resolved`.
No remote binary package is declared. Swift Dependabot is not configured for this project
shape. Review updates manually in Xcode, commit the exact requirement and resolved revision,
and run Apple validation. Do not create a synthetic Swift package solely to enable automation.

SBOM generation is **P2 for App Store readiness** under the current repo policy; no evidence
was found of a repository requirement making it a P1. It is useful for release inventory and
incident response, but is not a substitute for dependency audits or signed-artifact review.
A maintainer can generate a CycloneDX npm inventory from the reviewed lockfile with
`npm sbom --package-lock-only --sbom-format cyclonedx` in `services/api`, keep it attached to
the release commit, and separately record Swift resolved revisions and Actions pins. An npm
SBOM alone does not cover Apple assets or workflow dependencies. Do not describe a development
lock inventory as the exact shipped Worker dependency graph.

## Deferred follow-ups

General shell taint/static analysis (`curl | sh`, writes to `$GITHUB_ENV`, `npm install`,
indirect environment/control-flow propagation) remains a separate P2 follow-up. The explicit
structural checks here must not be described as solving it. SBOM inventory and hosted Pages
upload/deploy confirmation also remain follow-ups; neither SBOM nor absent hosted deployment
evidence is turned into a code merge blocker by this change. Required-check/account approval
evidence remains a separate production-readiness boundary below.

## Maintainer account actions (not performed or verified here)

These controls cannot be enforced by adding repository files. Inspect GitHub Settings and retain
evidence of the effective rules, including organization rulesets and bypass identities.

1. **Settings → Rules → Rulesets / Branches:** protect `main`, require PR review and the actual
   **PR validation** check from GitHub Actions; require the branch to be up to date (or configure
   a merge queue with its own supported checks before enabling it). Do not require the advisory
   live source-health job as a deterministic PR check. Verify a failing PR cannot merge.
2. Disable **Allow force pushes** and **Allow deletions**, or enable the corresponding ruleset
   restrictions. Apply protection to administrators where supported; review every bypass actor.
   Restrict direct pushes. Required checks alone do not prohibit all direct updates or bypasses.
3. **Settings → Actions → General:** default workflow permissions read-only; disable Actions
   creating/approving PRs; never enable sending write tokens or secrets to fork PR workflows.
   Restrict allowed actions and enable full-SHA enforcement if the account supports it.
4. **Settings → Environments → github-pages:** allow only main deployments, add a required
   independent reviewer, prevent self-review and disallow administrator bypass where supported.
   Verify the plan/repository visibility supports these protections. Create separate approval
   boundaries for any future production backend deploy; PR validation must not receive them.
5. **Settings → Code security:** enable dependency graph, Dependabot alerts/security updates
   and available secret-scanning/push protections. Review alert routing and npm tarball coverage.
6. Require independent review for workflow, guard, lockfile and dependency changes. If CODEOWNERS
   is added later, use real accountable identities and enable the corresponding review rule;
   a fictional owner or an unprotected CODEOWNERS file is not an effective control.

Missing effective main protection / required checks / production deployment approval is a
**P1 production-readiness gap** until maintainer evidence is recorded. The code changes alone
cannot close it. Hosted PR CI execution is also pending until an authorized push; local checks
are not evidence of a GitHub runner pass. No `act` run is required.

References: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference),
[protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[npm SBOM](https://docs.npmjs.com/cli/commands/npm-sbom/),
[reviewed upload wrapper](https://github.com/actions/upload-pages-artifact/blob/56afc609e74202658d3ffba0e8f6dda462b719fa/action.yml).

## Pages post-merge verification and rollback

A merge changing `.github/workflows/pages.yml` can automatically publish `site/`.
The PR artifact check does not exercise production deployment or repository/environment settings.
Before an authorized merge, record the latest successful Pages run, its commit SHA and public URL.
After the automatic run, the operator should:

1. Check the Pages workflow's build and deploy jobs both succeed on the merged main SHA;
   inspect the `github-pages` artifact and deployment URL. Check environment approval if queued.
2. Open the deployed root, `/privacy/`, `/support/` and `/style.css`; confirm successful responses,
   expected content and styling, including privacy/support links. Compare against the recorded
   previous release; this Actions-only change must not change site content.
3. If deployment fails, inspect logs before retrying; do not grant broader permissions or enable
   Pages automatically to work around a failure. Verify the previous public site remains available.
4. For an Actions regression, prepare a reviewed rollback PR restoring the three workflow files
   from the recorded known-good commit, together with matching CI guard/tests where necessary.
   Run contract/security/artifact checks before merging. Do not revert a merge commit blindly:
   that could undo unrelated main changes. Do not weaken secret scanning.
5. An authorized rollback merge changing pages.yml will trigger another Pages run. Verify its
   SHA, jobs and public URLs again. If site content itself needs restoration, restore only the
   reviewed `site/` files from the known-good release in a separate reviewed change. Publishing
   or dispatching a main workflow requires operator authorization; neither occurs during PR audit.

Artifact retention is one day; do not rely on an old downloadable artifact as the rollback source.
Use the recorded Git commit to rebuild, retaining immutable reviewed Action pins.
