# Bounded manual-review queue selection

Date: 2026-10-06. Base main: `a50bf2b67ba46702d8a43e36c0d553ad1621339a`
(#204 merged using a normal merge). Scope: cache-only selection before publisher deep review.

## Decision: no eligible P0/P1 candidate; research-only STOP

The latest tooling generated **552 advisory queue rows, all P3; P0 = 0, P1 = 0,
P2 = 0** from the existing local checkpoint and committed reviews.
There is no upper-priority, unimplemented/unapproved candidate to select under the
requested rules. **Deep-reviewed candidates: 0 / maximum 5.** Do not substitute P3,
retry rejected releases, invent a promising source, or broaden into live discovery.

No `IMPLEMENTATION_CANDIDATE` is declared and no source is implemented. This is a
bounded selection result, not a claim that no usable source exists nationwide.
No new official publisher page/data was fetched, because no candidate passed selection.
Current publisher rights, coordinates and operation were consequently **not newly verified**.

## Reproducible cache-only evidence

Used `buildReport` / `markdownReport` from
`services/data-pipeline/discovery/report.mjs`, without invoking a fetcher/scanner.
The local checkpoint was read, not modified. Report generation is current; cached
scans are historical (latest target timestamps 2026-09-30), not current operation evidence.

| Input | Identity |
| --- | --- |
| `services/data-pipeline/discovery/.local/state.json` | SHA-256 `be0693d7868122e8032f942633996553e6ed59972ada1b8f8796166e426df1c3`; 190 targets / 361 resources |
| `services/data-pipeline/discovery/manifest.json` | SHA-256 `f5db124e6e5410c5c092ea9581e13f268e71e46a1dacf4f97267e1c46d3a64fa` |
| Review arrays | The six committed review files listed below; combined without rewriting dates, verdicts or narrative gates |

Review inputs under `docs/research/nationwide-discovery/`:

- `2026-09-30-reviews.json`
- `2026-10-01-east-deep-reviews.json`
- `2026-10-01-high-value-reviews.json`
- `2026-10-01-v2-reviews.json` (`reviews` array)
- `2026-10-01-west-reviews.json`
- `2026-10-01-official-reverse-reviews.json`

Local, untracked generated artifacts:

- `/tmp/mannerpath-queue-deep-review-4eLAeH/report.json`
- `/tmp/mannerpath-queue-deep-review-4eLAeH/report.md`

For reproduction, read the manifest and state JSON; flatten those six review arrays;
call `buildReport(manifest, state, reviews)` and `markdownReport(report)`; filter
`manualReviewQueue` for priorities `P0`/`P1`. No live scan or approval is involved.
The checkpoint is not committed here; reproducing its exact result requires those
same checkpoint bytes, not merely the same main revision.

| Classification | Rows |
| --- | ---: |
| `NO_SMOKING_POINT_EVIDENCE` | 158 |
| `FORMAT_BLOCKED` | 144 |
| `MANUAL_REVIEW_REQUIRED` | 99 |
| `ACCESS_BLOCKED` | 145 |
| `ALREADY_IMPLEMENTED` | 6 |

Report metrics: keyword candidates 3; legacy individually reviewed candidates 22,
all 22 rejected; completed dated deep-review groups 39, all 39 blocked;
`newApproved = 0`, `newImplemented = 0`, `approvalAutomated = false`.
These are existing discovery/review metrics, not production spot counts.
An implemented target row does not authorize new resources under that municipality.

## Why the three keyword candidates are not a new shortlist

These are **excluded historical hits**, not three newly deep-reviewed candidates.
The following decisions summarize prior review evidence; all current-operation and
resource-specific rights/coordinate gates remain unverified in this task.

| Historical resource | Queue result | Prior smoking-point finding / decision | Rights | Publisher smoking-point coordinates | Current operation / maintainability |
| --- | --- | --- | --- | --- | --- |
| 津市 `bunbetsu20240419.csv` | P3 / `NO_SMOKING_POINT_EVIDENCE` | Garbage classification keyword hit; `NOT_SMOKING_POINT_DATA`, already rejected | Unknown for a smoking release | None verified; cached availability missing | No eligible smoking release; no new verification |
| 大阪市 `contents/wdu290/opendata/csv/resource.csv` | P3 / `MANUAL_REVIEW_REQUIRED` | Catalog metadata hit, not smoking-point raw data; `NOT_SMOKING_POINT_DATA`, already rejected | Unknown for the exact smoking-point resource | None verified; cached availability missing | No new verification; distinct from the existing approved Osaka source |
| 杉並区 `documents/8444/open-data-list.csv` | P3 / `FORMAT_BLOCKED` | Index entry describes road-smoking prohibition districts, not permitted smoking points; `NOT_SMOKING_POINT_DATA`, already rejected | Unknown for the exact smoking-point resource | None verified; cached availability missing | No new verification; target format/access blockers retained |

Prior evidence: [2026-09-30 review records](nationwide-discovery/2026-09-30-reviews.json).
No priority or keyword count grants reusable rights or proves coordinates belong to
a smoking place. Ordinary website copyright terms are not open-data licenses.
Narrative approval gates are not converted into positive booleans.

## Exclusions and next boundary

Fuchu, Urayasu, Ebina and Narashino are excluded as requested, along with existing
blocked/rejected releases, external JT referral-only data, OSM and community.
No excluded candidate is reconsidered here. No address geocoding or publisherPoint
inference occurs. There is no selected candidate to classify as rights/coordinate
blocked or current-operation-unknown following a new deep review.

To resume a genuinely new investigation, supply a new official, exact-resource lead
or explicitly authorize a separate bounded discovery/update pass. Do not manufacture
P0/P1 by changing historical metadata, suppressing blockers or interpreting license prose.
That future pass would still require human review of smoking-point evidence, exact
commercial reuse/redistribution terms and attribution, publisher-provided coordinates,
current operation and maintainability before adapter work.

## Scope and validation

Only this research Markdown is changed. No source registry, adapter, fixture,
release metadata, schema, API, Apple or Cloudflare changes. No production queries,
remote D1 writes, deployment or publication. Existing production release evidence
remains **513 published spots / six approved sources / community 0**, not remeasured here.
Issues #67/#113/#137/#141 remain open; no coverage completion is claimed.

Validation: `make api-validate` (Node 24), `make contract`, `git diff --check`.
Fresh local ingest/quality is not applicable: no source was implemented.
