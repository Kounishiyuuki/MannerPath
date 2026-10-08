# Open provider nationwide discovery — Batch 2 (2026-10-08)

## Result

50 unique raw references, 2 newly generated onboarding review packets, and 2 deep reviews; **0 IMPLEMENTATION_CANDIDATE, 0 new sources, 0 added spots**. All new references remain publication-blocked. The ceilings (100/30/10/3) are limits, not quotas. No production mutation, remote D1, geocoding, API/schema/Apple changes, registry changes, or publication occurred. Existing six sources and the production 513-spot corpus were not modified.

[Machine-readable evidence](nationwide-discovery/2026-10-08-open-provider-batch-2.json) contains query parameters, exact resource URLs, response hashes, fetch times, limitations, triage, rights, coordinate authority, blockers and next actions. It is a bounded summary, not a raw provider corpus; raw bodies, POI coordinates, contributor identities and feature rows stay outside the repository.

## PR #214 landing

Independent read-only review of `f894906b9949b8157727b3cc96faafca22d6656c`: **MERGE READY**, no P0/P1/P2 remaining. The common byte check rejects 2,097,153 bytes and accepts 2,097,152 bytes across network/cache/304/redirect/fixture transports before parsing. Optional Overture metadata does not abort the run; missing license remains unknown/blocked. Provider discovery still requires onboarding and human gates.

Focused tests: 23/23; review-head API: 883/883; discovery: 101/101. Temporary checkout environment failures were rechecked in suitable git/non-temporary working directories. After merging main while retaining both provider and capacity npm scripts, landing validation passed API 895/895 and discovery 101/101, contract and diff checks. [PR #214](https://github.com/Kounishiyuuki/MannerPath/pull/214) merged on 2026-10-08; merge commit/base for this batch: `3ac1064ef10d9d85ed1da2782aa8cb5dc8b4b0c9`.

## Method and coverage

The landed provider layer and FetchCache were used, with 1.5 seconds/host, 15-second timeout, no retries, 2 MiB cap and persistent 403/429 stop. Static discovery keywords included 喫煙所, 喫煙場所, smoking area and title wildcard 喫煙; no user query, location or credential was supplied. There were 20 bounded metadata scan invocations, not 20 HTTP requests: catalog pagination, cache hits, redirects and stopped hosts differ. Per-provider invocation was bounded at 20 references; global unique raw references at 100. Identity checks and eight selected-service metadata/layer/sample GETs were separate evidence work.

| Region | Region-specific scan invocations | Assigned raw references | Deep reviews |
| --- | ---: | ---: | ---: |
| 北海道・東北 | 3 | 0 | 0 |
| 関東 | 3 | 27 | 0 |
| 中部 | 2 | 1 | 1 |
| 近畿 | 1 (two CKAN catalogs) | 0 | 0 |
| 中国・四国 | 2 | 0 | 0 |
| 九州・沖縄 | 3 | 1 | 1 |

Six additional nationwide scans account for the remaining invocations. Twenty-one references have no reviewed regional assignment (20 OpenPOI leads and one campus survey). Assignment describes triage context, not verified coordinates. This is bounded coverage, not an exhaustive nationwide search or a regional absence claim. Sapporo/Gifu/Kobe returned no matching resource in these queries; Akita/Okayama routes were unavailable, Saitama returned incompatible content and other endpoints were blocked/unavailable. These do not demonstrate provider worthlessness or change source approval.

## Provider results and triage

| Provider | Observations and disposition |
| --- | --- |
| BODIK ODCS/ODM | Six unique canonical-resource discovery references: existing/historical Taito, Koto and Minato resources. No new approved source. Regional ODM queries returned no additional matches. |
| Municipal CKAN | Three Tokyo resource observations duplicate the above URLs; other bounded catalogs had zero hits or access/format limitations. CKAN contributes zero *first-observed unique* references, not zero useful observations. |
| Public ArcGIS | 22 unique references: 19 keyword-matching routes, one campus survey and two selected unknown-authority hosted services. Routes and surveys were excluded as smoking-place evidence. A public service URL/owner name is not official publisher authority. |
| Catalog-linked ArcGIS inventory | Two Shibuya statistics/enforcement/survey references; no smoking-point resource adopted. Resource authority and rights still require review. |
| OpenPOI | 20 discovery-only leads; response SHA-256 identical to Batch 1. No generic POI conversion, coordinates import or new deep review of unchanged leads. |
| Overture | STAC catalog inspection only; no bounded Places export obtained, zero Places record candidates. No corroboration or smoking existence claim. |
| Official catalog pages | Hokkaido, Shizuoka, Okayama and Okinawa bounded inventory checks. A Shizuoka login `.part.json` link was excluded as navigation, not a dataset candidate. |

Thus 48 references were excluded before generating two new packets. BODIK/CKAN can discover canonical *candidates*, while OpenPOI/Overture remain discovery-only and BODIK WAPI remains schema inventory; none grants record publication rights. Both generated onboarding packets are BLOCKED, with `approvalAutomated=false` and `productionApproval=false`. Six existing LOCAL_PIPELINE_READY baseline entries in onboarding are not six new review packets or new approvals.

Catalog response hashes matched prior BODIK/ODM observations; this does **not** prove every underlying raw resource unchanged. Koto park CSV raw bytes independently matched its prior hash, so its prior operation-conflict block remains. Historical Taito URLs returned 404. Minato CSV returned 403, and subsequent same-host JSON was stopped without another network request. Existing-source/historical resources were excluded by source scope, not all by proven byte identity.

## Deep review

| Candidate | Evidence | Rights / coordinates / operation blockers | Next action |
| --- | --- | --- | --- |
| Kitakyushu `kitsuensho` hosted survey service, item `23534bd4681b4cbab53abd995d62397c` | Collaborative survey schema; bounded sample 20 rows and transfer-limit flag. Account wording does not establish municipal ownership. | Item license and service copyright empty; commercial use, redistribution, derivation and attribution unknown. Point CRS 102100/latest 3857, but publisher coordinate authority unknown. 2014-era survey/2015 item metadata does not establish current smoking operation or cadence. | Obtain independently official publisher resource, scoped rights, smoking permission evidence and current operation. |
| のんほいマップ hosted CSV service, item `665ad32d7bcb4157aa9c34522d467f51` | University-hosted inventory: complete 18-row sample, two explicitly named smoking locations; shops/rest areas excluded. Layer names a 2019-01-12 inventory. | Original Toyohashi/operator authority and applicable resource license unconfirmed; license/copyright empty. Point CRS 102100/latest 3857 and latitude/longitude fields exist, but authority is third-party/unreviewed. 2026 upload date and currently operating park do not establish those smoking points' current operation. | Request original official CSV/current smoking-point authority and exact reuse terms; do not import third-party coordinates. |

Exact service, layer and sample URLs and their hashes are in JSON. Official [Toyohashi park reference](https://www.city.toyohashi.lg.jp/12037.htm), [park operation page](https://www.nonhoi.jp/information/) and [park map page](https://www.nonhoi.jp/gps/) establish host context only; ordinary webpage rights were not extended to the hosted export, images were not geocoded, and host hours were not assigned to smoking points. [Kitakyushu guidance](https://www.city.kitakyushu.lg.jp/category/90001095.html) did not establish authority for the discovered survey service.

## Rights and publication boundary

[OpenPOI API terms](https://docs.openpoiapi.com/legal.html) permitting commercial access do not waive record/source license and attribution obligations. [Overture attribution](https://docs.overturemaps.org/attribution/) requires preserving applicable source distinctions; a permissive Places license is not smoking-place existence evidence. [CDLA-Permissive 2.0](https://cdla.dev/permissive-2-0/) agreement retention and [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) applicable license/notice obligations remain distinct from CC BY attribution, CC BY-SA share-alike and ODbL restrictions. No new license full text or upstream dataset was redistributed in this batch. Missing license never becomes permissive by inference. Provider → onboarding → human gate remains the only path; no automatic approval or canonical spot generation occurred.

## Rechecking and validation

Use Node 24.21.0 (repository minimum is 23.3). The JSON records bounded query/catalog parameters, page counts, time limits, URLs and hashes. For example, from `services/api`, run `npm run discovery:providers -- --provider bodik --catalog https://data.bodik.jp --catalog https://odm.bodik.jp --query 'title:*喫煙*' --max-candidates 20 --max-pages 2 --cache /private/tmp/batch2-recheck-cache --out /private/tmp/batch2-recheck-bodik.json` (choose a fresh output path); use the JSON configurations for other invocations and the existing `npm run source:onboarding -- --discovery-report <report> --out <output>` command; cache/raw outputs must remain outside git. Live availability/content can change; future hash differences require review, not automatic approval. Offline deterministic provider tests, not live API availability, are the test gate.

Batch 2 checks passed: provider focused tests 23/23; `make api-validate` (typecheck, API 895/895, discovery 101/101); `make contract`; `git diff --check`; summary assertions for 50 distinct references, two blocked packets and six preserved baseline states. Independent read-only artifact review reconciled counts and found no rights/authority inference or raw feature/identity corpus; its CLI documentation correction was applied. No new source passed all gates, so a new-source migration/pipeline/quality/promotion build was not applicable; no new adapter, fixture, registry or production release was created.
