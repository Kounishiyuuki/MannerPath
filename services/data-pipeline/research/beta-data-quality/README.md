# Beta data-quality gate (Issue #33, re-measured after Issue #42)

Artifacts behind `docs/BETA_DATA_QUALITY.md`. Both are regenerable; neither is an input to the build.
Both were regenerated on 2026-09-21 after the Issue #42 reconciliation; the pre-reconciliation
versions are in git history.

| File | Produced by | What it is |
|---|---|---|
| `2026-09-21.json` | `cd services/api && npm run local:quality -- --now 2026-09-21T00:00:00Z` | The corpus measurement of the local publication state (read-only D1 analysis). |
| `2026-09-21-spot-check.json` | `node spot-check.mjs` | 台東区's current release file and list page compared with the committed fixture, as of the `checkedAt` timestamp in the file. |

`spot-check.mjs` fetches from `city.taito.lg.jp` and writes nothing. Re-running it later will differ
from the committed output once the ward re-releases the file or edits its list page — that is the
point: a difference is the signal that the corpus needs re-reviewing.

Since Issue #42 that signal has teeth: the findings here are the evidence behind the attestations in
`services/api/src/pipeline/taito-list-page.ts`, which decide what the pipeline refuses to publish.
A finding that appears, changes or disappears means those attestations must be re-reviewed — and the
importer refuses a release whose records no longer match them.
