# Official source onboarding — batch 1

Date: 2026-10-07. Base main: `f7c30f13116f519cff67cc8361e1224267f59c2d` (PR #212 merged).

## Decision

**RESEARCH-ONLY STOP: 0 of at most 5 new candidates selected; 0 new sources implemented; 0 spots added.**

The existing discovery/manual-review queue supplies no eligible new lead after excluding already reviewed/blocked resources and existing implemented sources. This is a bounded result for this checkpoint, not a claim that Japan has no other usable official sources. No fresh discovery crawl or live publisher verification was performed because no candidate survived selection. Queue priority alone is not a rejection gate: P3 does not mean ineligible, and this batch does not require P0/P1.

## Selection evidence

Rebuilt the discovery report locally with `buildReport(manifest, state, reviews)` using the six committed review arrays listed in the [previous queue audit](2026-10-06-manual-review-queue-deep-review.md). The checkpoint is unchanged:

| Input | SHA-256 |
| --- | --- |
| `services/data-pipeline/discovery/manifest.json` | `f5db124e6e5410c5c092ea9581e13f268e71e46a1dacf4f97267e1c46d3a64fa` |
| `services/data-pipeline/discovery/.local/state.json` | `be0693d7868122e8032f942633996553e6ed59972ada1b8f8796166e426df1c3` |

The local checkpoint is not committed; reproduction requires these exact bytes, not a future scan. The report has 190 tracked/scanned groups, 361 checkpoint resources, 552 advisory queue rows (all P3), three keyword candidates, 22 individually reviewed/rejected historical keyword candidates, and 39 completed deep-review groups, all blocked. These counts describe different report populations; they are not 552 independently reviewed smoking datasets.

The [official reverse review](nationwide-discovery/2026-10-01-official-reverse-reviews.json) records 184 blocked targets and six existing pinned sources. The [v2 review](nationwide-discovery/2026-10-01-v2-reviews.json) records 16 blocked reviews and no unreviewed hits. The east review's historical Yamanashi candidate was subsequently blocked in the [October 4 rights audit](2026-10-04-high-value-source-rights.md); it is not a new lead.

The three cached keyword hits below were screened by reading prior decisions, **not investigated again**:

| Historical resource | Prior finding | This batch |
| --- | --- | --- |
| Tsu `bunbetsu20240419.csv` | Garbage classification containing an ashtray keyword, not smoking-place point data | Excluded; no new rights/coordinate/operation review |
| Osaka `contents/wdu290/opendata/csv/resource.csv` | Catalog metadata, not raw smoking-place data; distinct from the existing approved Osaka source | Excluded; no new rights/coordinate/operation review |
| Suginami `documents/8444/open-data-list.csv` | Index of road-smoking prohibition districts, not permitted smoking points | Excluded; no new rights/coordinate/operation review |

See [September 30 resource decisions](nationwide-discovery/2026-09-30-reviews.json). Recently reviewed blocked Chuo, Hiroshima, Kawasaki, Shinjuku, Bunkyo, Itabashi, MLIT Shinjuku R2, Suginami and Yamanashi were excluded using the October 4 audit. No address geocoding, external-map coordinate substitution, or ordinary-webpage license inference was performed.

## Gate results and actual tooling use

There is no new selected resource on which to make a fresh gate decision:

| Gate | New-candidate result |
| --- | --- |
| Official publisher | Not evaluated — no selected candidate |
| Smoking-place existence evidence | Not evaluated — historical non-smoking hits excluded above |
| Exact resource | No eligible new resource selected |
| Reuse rights | Not evaluated; unknown is not approved |
| Attribution | Not evaluated |
| Publisher-provided smoking-place coordinates | Not evaluated; no inferred coordinates |
| Current operation | Not live verified |
| Maintainability | Not newly evaluated |

The committed [bounded selection input](nationwide-discovery/2026-10-07-batch-1-selection.json) contains empty resources/targets/manualReviewQueue arrays. This deliberately sends **zero new candidates**, rather than hundreds of historical exclusions, into onboarding. Run from `services/api`, with a fresh output path:

```sh
npm run source:onboarding -- --discovery-report ../../docs/research/nationwide-discovery/2026-10-07-batch-1-selection.json --out /tmp/batch-1-review.json
```

The [actual generated review packet](nationwide-discovery/2026-10-07-batch-1-onboarding-review.json) contains only the six existing source baselines:

| Existing source | Validator state | Blockers |
| --- | --- | --- |
| Taito | LOCAL_PIPELINE_READY | None |
| Osaka | LOCAL_PIPELINE_READY | None |
| Koto | LOCAL_PIPELINE_READY | None |
| Kyoto | LOCAL_PIPELINE_READY | None |
| Musashino | LOCAL_PIPELINE_READY | None |
| Minato | LOCAL_PIPELINE_READY | None |

The command also emits Markdown at `<output>.md`. `approvalAutomated=false` and `productionApproval=false` throughout. This validates pinned fixtures and implementation metadata; it does not prove latest live operation, confer source approval, or run fresh quality/promotion. Those remain `notEvaluated`. Empty blocker/review queues refer only to this selected input plus existing baselines, not nationwide readiness.

No scaffold was generated: without an eligible resource it would add no useful implementation evidence. No adapter, fixture, registry entry or release was added. Fresh local ingestion and quality checks are not applicable to this research-only result.

## Safety boundary and next action

Production coverage is unchanged by this work. No production read/write, remote D1, Cloudflare operation, geocoding, publication or source approval occurred. API, schema, account and Apple code are unchanged. ADR-0011 remains proposed; derived-coordinate publication is not activated. Rights blockers remain independent of coordinate tooling.

Resume implementation when a genuinely new official exact-resource lead becomes available, or in a separately scoped discovery refresh. Human review must verify all eight gates above; then at most one source can proceed through adapter/fixture/tests, fresh local pipeline and quality. An onboarding READY state still does not authorize production publication.

## Validation

PR #212 landing: Node 24 `make api-validate` passed (881 API tests and 78 discovery tests); `make contract` and `git diff --check` passed. Existing six-source validator results were unchanged.

Batch 1: Node 24 `make api-validate` passed (typecheck, 881 API tests and 78 discovery tests). `make contract`, `git diff --check`, and byte-identical packet reproduction/six-source fail-closed consistency passed. Independent read-only review found no material issues. No new behavior tests were added because this batch changes research artifacts only.
