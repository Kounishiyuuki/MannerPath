# Dependabot / CI dependency review — 2026-10-31

Base: `origin/main` `112b919093b9a9a49ab1b274baeedc0a46dbe2bf` (#349 Hono and #346 Workers types integrated).
API validation and Actions changes use separate worktrees. No Apple/photo feature source, API contract,
production configuration, source/publication gate or public site bytes are changed by the Actions PR.

## Recommendations and snapshots

| PR | Target / audited HEAD | Recommendation | Reason |
| --- | --- | --- | --- |
| #310 | Zod 4.6.7 / `36970cd6747cffabcc20e5d7b620ad14a9ef55cf` | MERGE | Already refreshed against current main; runtime memory-exhaustion fix; exact manifest/lock match |
| #345 | Wrangler 4.154.0 / `665f867360e5ec5ce77f48862c8b639c289f350f` | MERGE | Updated from the earlier 4.152.0 proposal during this audit; fixes vulnerable dev-tool dependencies and matches merged Workers types |
| #240 | checkout 7.0.1 / `755909a0ca7f08c6b0e6e6df93c1ac10f3e578bc` | REWORK | Use the separate current-main Actions PR with corrected comments, current compatibility evidence and non-deploying artifact CI |
| #239 | configure-pages 6.0.0 / `d6ef8e87c58116666876fa9ca723bdff795d5abb` | REWORK | Same Actions integration; old successful PR checks did not execute configure-pages |
| #238 | upload-artifact 7.0.2 / `2f553a3c240bce0c4e95710b0186dca946c026f6` | REWORK | Same integration; explicitly preserve ZIP/name contract and test hosted artifact upload |
| #237 | deploy-pages 5.0.1 / `64491c5b5a58c1ac869d71eadaa114a1e937aaae` | REWORK | Same integration; keep main/environment/write boundaries; actual deployment remains separately authorized |

All six snapshots merge mechanically with current main (`git merge-tree --write-tree`, exit 0).
No original PR is merged, closed or force-pushed here. If a head changes, the recommendation is scoped
to the snapshot above and its new diff/checks must be reviewed again.

Safe integration order: #310 → #345 → the Actions integration PR. The two API updates are already
fresh and independently reviewable, so replacing them with a duplicate integration PR is unnecessary.
After each merge, confirm the remaining PR's merge result and checks again. Do not merge both the
Actions integration and the superseded Action proposals without reviewing the resulting diff.

## Existing checks

- #310 current HEAD: [PR validation PASS](https://github.com/Kounishiyuuki/MannerPath/actions/runs/41184150218), 2026-10-31.
- #345 current HEAD: [PR validation PASS](https://github.com/Kounishiyuuki/MannerPath/actions/runs/41184169054), 2026-10-31.
- #240: [PASS](https://github.com/Kounishiyuuki/MannerPath/actions/runs/39152902663), 2026-10-18.
- #239: [PASS](https://github.com/Kounishiyuuki/MannerPath/actions/runs/38286381500), 2026-10-12.
- #238: [PASS](https://github.com/Kounishiyuuki/MannerPath/actions/runs/38286375514), 2026-10-12.
- #237: [PASS](https://github.com/Kounishiyuuki/MannerPath/actions/runs/38286363747), 2026-10-12.

The old Action check dates and base are not proof of the current combination or hosted Pages behavior.
The new Actions PR runs current-main PR validation plus a separate read-only Ubuntu artifact job.
Its actual run and downloaded artifact evidence are recorded in the PR's final report.

## API dependency compatibility and security

The current #310/#345 diffs were applied together to current main in the API validation worktree.
`npm ci --ignore-scripts` succeeds under Node **24.21.0**, with no invalid/missing peer dependencies
(`npm ls --all`). Hono **4.13.13**, Workers types **5.20261023.1**, exact TypeScript and SheetJS pins are
preserved. Both updated package integrities match npm registry metadata; `npm audit signatures` exits 0
with `invalid: []` and `missing: []`. The existing non-registry SheetJS tarball/integrity is unchanged;
registry audit/provenance is not a comprehensive audit of that external tarball or shipped Worker.

Wrangler 4.154.0 declares Node >=22 and Workers types `^5.20261023.1`; the repo's Node >=24 contract
and installed types meet both. The local dev chain moves Miniflare 5.20261006.1-alpha →
5.20261023.1-beta, workerd 1.20261006.1 → 1.20261023.1 and Undici 7.29.1 → 7.30.1.
The explicit compatibility date and all resource/feature flags remain unchanged.

The P1 ordering below is this repository review’s integration priority, not a vendor severity SLA.

The npm audit snapshot for main reports **4 dependency entries (2 high, 2 moderate)**: Zod,
Undici, and its Miniflare/Wrangler parent chain. The tested combined update reports **0**.
This is the registry's dated graph result, not a guarantee of complete vulnerability absence.

- **P1: Zod runtime fix.** [Upstream #6652](https://github.com/colinhacks/zod/pull/6652) makes bounded
  collections reject oversize input before element parsing (GHSA-mrhx-c7xc-m3w5). Existing request-body
  limits remain defense in depth; the update does not replace them or add bounds to unbounded schemas.
- **P1: Wrangler dev-tool chain.** Its updated Undici removes the audit findings on the old graph.
  This is not a production Worker dependency. The older Wrangler pages command-injection advisory
  [GHSA-36p8-mvp6-cv38](https://github.com/cloudflare/workers-sdk/security/advisories/GHSA-36p8-mvp6-cv38)
  was fixed in 4.59.1 and is not the reason 4.149.0 needs this update.
- **P1 maintenance: Actions Node 24 migration.** [GitHub retired Node 20 on runners](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/).
  The update also includes checkout credential/fork protections. Existing checks passing under a
  runner's compatibility behavior are not evidence that keeping old Action runtimes is preferable.

[Zod's release notes](https://github.com/colinhacks/zod/releases/tag/v4.6.6) disclose the upstream
Git credential incident and state the malicious commits were not published to npm. This review
uses exact npm artifacts with verified signatures/integrities, not a Git main dependency. It does
not independently certify that every byte of an upstream package is benign.

## Verification and limits

| Verification | Result |
| --- | --- |
| Combined API `make api-validate` | PASS: 1,382 API tests + 102 discovery tests; no failures, cancellations or skips |
| Combined API install / peer tree / audit / signatures | PASS; audit 0; invalid/missing signatures 0 |
| Wrangler local D1 migrations | DB and REPORTS_DB migrations PASS, all-zero local IDs, isolated worktree state |
| Updated Wrangler/workerd | Local dev starts; `/v1/config` schema 1 returns 200, empty tile returns 404 |
| Actions contract | 11 tests PASS |
| Actions policy regression tests | 18 tests PASS, including ZIP/name and required-job skip protection |
| Full Actions security validation | PASS in the independent non-shallow clone: policy18, archive6, guardrail13, release/config16, history suspects0; hosted result recorded in the PR report |

No `npm audit fix --force`, lifecycle-script enablement or source/API changes are used to make tests pass.
Initial root-directory install attempts failed (`EUSAGE`); they are setup errors, not lockfile failures.
A first clean-clone security run then failed with missing modules; dependencies were installed under
`services/api` and the complete target rerun. Failed/incomplete runs are never counted as PASS.

Shared worktrees' `--history` scan also reaches unrelated local refs. It flagged one credential-assignment
candidate in commit `45a4301488423fed9ce460040c31c4ec8643392b` on local `test/v1-photo-report-e2e`.
That commit/blob is not reachable from main or this Actions HEAD; the current tracked file has no
matching detection. Candidate values were not printed or classified as real/false credentials.
Neither the photo branch nor the scanner is changed. Validation uses a non-shallow independent clone
of the tested branch with main ancestry retained and the unrelated local blob excluded; hosted CI
remains the authority for GitHub's actual fetched refs. The separate local history finding needs its
owner's review before that branch is ever integrated.

## Pages and release impact

The [pin inventory and runtime requirements](../CI_SUPPLY_CHAIN_SECURITY.md#action-pin-inventory)
record the official tags and Node 24 requirements. Action runtime and API setup-node version are separate.
The existing GitHub-hosted macOS 15 and Ubuntu runners are retained; no self-hosted/container auth is added.

Upload-artifact v7's direct mode would ignore `name`; this change keeps **`archive: true`** and
`github-pages` containing `artifact.tar`. The normalized packager and site bytes are unchanged.
A new read-only Ubuntu job uploads **`pages-validation`**, never `github-pages`; it has no Pages
write permission, OIDC, deployment environment or configure/deploy step. Its hosted artifact can be
downloaded and checked without publishing anything.

Configure-pages v6 keeps `enablement: false`; deploy-pages v5 keeps `artifact_name: github-pages`,
`preview: false`, and `page_url` output. These are verified from the pinned official action metadata.
Deployment itself is **not executed** in this audit. A successful package/upload does not prove
that GitHub Pages permissions, account/environment controls or the final deployment are configured.

A maintainer's future merge of the Actions PR changes `pages.yml`, so the existing main push filter
will republish unchanged `site/`. Review/approve that maintenance window separately. This task performs
no dispatch, production deploy, Pages settings/content change or main merge. Applying Zod to a deployed
Worker also needs the normal separately authorized release; passing dependency CI does not approve it.
