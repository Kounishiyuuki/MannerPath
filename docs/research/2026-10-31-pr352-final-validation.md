# PR #352 final verification

## Diff cleanup after #357

The earlier snapshot below is historical. After #357, the Actions-only patch was
reapplied onto main `a5c944a` in an independent worktree as a single new commit.
The former merge commits are not part of the new PR history. The nine-file scope
contains only workflows, CI guards/tests and related documentation; no Apple, API,
release submission or public site files are changed. Current-head CI is recorded
in the PR report. Post-publication checks and rollback steps are documented in
`docs/CI_SUPPLY_CHAIN_SECURITY.md`.

## Earlier validation snapshot

Snapshot UTC 2026-10-31. Latest main: `1e2d0099a7fb7b6af5eb17f05f352e41db0840e1`.
Starting #352 HEAD: `cfe585ba273265698dd38e2fb2b24e57706b0cdf`.
A new worktree/validation branch was created from current main, then #352 was merged normally
without conflicts. This retains main's already-merged #310/#345 and subsequent Apple/release work.
The PR diff against current main changes no API/photo code, public site bytes or secret scanner.

## Superseded proposals

| Old PR | Preserved update | Matched locations |
| --- | --- | ---: |
| #237 | deploy-pages5.0.1 / `368f82528645a54fb793d4d04e342629a3f51346` | 1 |
| #238 | upload-artifact7.0.2 / `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | 2 |
| #239 | configure-pages6.0.0 / `45bfe0192ca1faeb007ade9deae92b16b8254a0d` | 1 |
| #240 | checkout7.0.1 / `3d3c42e5aac5ba805825da76410c181273ba90b1` | 3 |

All added `uses` pins in the four current old-PR diffs match the integrated workflows.
#352 additionally corrects old version comments, fixes ZIP semantics, adds non-deploying artifact
validation, and protects required validation from sibling-job skips. The old proposals need not
be merged on top of #352. Recommended closure: after #352 passes the unchanged required checks
and is accepted/merged, close #237–#240 as superseded with a #352 link. This task closes none.
Do not use their older green checks to bypass a current security failure.

## Runtime, permissions and handoff

Official pinned metadata was rechecked: checkout7/configure-pages6/upload-artifact7/deploy-pages5
run on Node24. Checkout's minimum Actions Runner is2.327.1; the2.329.0 requirement is specific to
authenticated Git in Docker, which is not used. API Node stays24.21.0. GitHub-hosted macOS15 and
Ubuntu remain the runners, with credential persistence disabled and no unsafe PR checkout override.

Production Pages retains:

- main-only push/dispatch guards on both build and deploy;
- a read-only build, normalized `artifact.tar`, uploaded as ZIP (`archive: true`), named `github-pages`;
- deploy's matching default `artifact_name: github-pages`, `preview: false`, `page_url` output;
- Pages write/OIDC scopes and `github-pages` environment only on deploy;
- configure-pages default `enablement: false`.

The PR artifact job uploads `pages-validation`, with no Pages environment, write/OIDC permission,
configure/deploy Action or dependency that could skip required API/security validation.
The upload v7 direct mode ignores `name`, so it must not replace ZIP mode for the Pages contract.

## Local results on current-main integration

- `git diff origin/main...HEAD --check`:PASS.
- `make contract`:11/11 PASS.
- `scripts/check-ci-security.py`:PASS.
- `scripts/test-ci-security.py`:18/18 PASS.
- `scripts/test-pages-artifact.py`:6/6 PASS.
- Real packager output matches all4 site files byte-for-byte, has only regular files/directories,
  mode644/755, zero uid/gid/mtime, no absolute/traversal names or links.
- Tar SHA256: `4fc4a9ddaa17964c74a2e5884787424727d9b49b6cc2212dfb319f36a6848472`.
- Independent security review found no blocking workflow/permission/handoff issue.

The previous cfe585b [CI](https://github.com/Kounishiyuuki/MannerPath/actions/runs/41185825641)
passed both jobs. That is historical evidence; the final verdict uses the new integrated HEAD's
hosted checks and artifact, linked in #352's latest report. No historical PASS substitutes for
an incomplete or failed current-head security check.

## #360 history scan: read-only investigation

[Run41208413624 attempt1](https://github.com/Kounishiyuuki/MannerPath/actions/runs/41208413624/attempts/1)
reported one `authorization-bearer` candidate at `docs/release/V1_FREE_TIER_PROBE_RUNBOOK.md`,
commit `72ce7d3732277f4130e425eec4eef2b257fc45fa` (981 tracked files,3508 reachable blobs).
Only detection metadata was displayed; candidate values were not printed or classified.

Read-only ancestry/ref checks show:

- the flagged commit is not an ancestor of current main, integrated #352, or current #360 HEAD
  `4e0a4a2ef49cfea8558a0fe7396142115a2f41d7`;
- local refs `feature/free-tier-probe` and `origin/feature/free-tier-probe` still reach it;
- `git ls-remote --heads origin` no longer advertises that old branch;
- the actual CI checkout log fetches all remote heads and tags; the scanner runs
  `git rev-list --objects --all` with `fetch-depth: 0` preserved.

This explains why identical code can have different scan results as advertised Git refs change.
It does not justify a detector exception or hiding live refs. No existing local/remote ref was
removed, no scanner/ignore rule was edited, and checkout depth/ref scope was not narrowed.
#360's same-HEAD retry was in progress during this investigation; its outcome must be read as
that attempt's result. #352 must pass its own unchanged full-history CI before MERGE approval.

## Publication risk and unverified boundary

No main merge, workflow dispatch, Pages settings/content change, production deploy, original-PR
closure or #360 source/ref modification is performed here. A future maintainer merge of #352
changes `pages.yml` and triggers the existing workflow to republish unchanged `site/`.
Choose that maintenance window deliberately. Static/runtime/artifact verification cannot prove
an actual configure/deploy run or the effective repository/environment permissions; exercising
publication is outside this task's authorization.

Official sources: [checkout requirements](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/README.md),
[upload metadata](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml),
[configure metadata](https://github.com/actions/configure-pages/blob/45bfe0192ca1faeb007ade9deae92b16b8254a0d/action.yml),
[deploy metadata](https://github.com/actions/deploy-pages/blob/368f82528645a54fb793d4d04e342629a3f51346/action.yml).
