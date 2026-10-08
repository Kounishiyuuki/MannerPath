# Open-provider discovery — bounded live review

Date: 2026-10-08 (JST). Base main after PR #213 landing: `f56ba19d64177853f0bae0fba9233731da900e6f`.

## Outcome and boundary

Implemented local provider discovery plus the existing onboarding handoff. **Six unique exact-resource candidates, 20-entry final worklist, three deep-reviewed paths, zero new implemented sources and zero added spots.** All six resource URLs are existing-source publications, alternate formats/old releases, or the already blocked Koto park resource. None is a new approved source. Production coverage is unchanged.

The [compact scan/review evidence](nationwide-discovery/2026-10-08-open-provider-run.json) preserves provider terms independently of catalog/resource terms and carries request URLs, fetch dates, hashes and review blockers. Catalog update/fetch timestamps are not `lastVerifiedAt` or proof of operation. Full raw cache/POI response stays local. This bounded scan does not establish national completeness or absence of usable sources.

## Live docs and provider classes

Provider terms checked live on this date; declarations below do not auto-approve any record or resource.

| Provider | Role | Free/authentication | Commercial / storage / reuse | Source obligations |
| --- | --- | --- | --- | --- |
| BODIK ODCS/ODM CKAN | CANONICAL_CANDIDATE_PROVIDER | Public read API worked without key; no billing flow | Resource-specific; no blanket content grant inferred | Municipal publisher, exact resource, original terms and attribution reviewed separately |
| Municipal/government CKAN | CANONICAL_CANDIDATE_PROVIDER | Public searches worked on Tokyo and Minato portals | CKAN software/API access does not license dataset contents | Keep license ID/name/URL, resource-specific override, author/publisher and dataset/resource dates |
| OpenPOI API | DISCOVERY_ONLY_PROVIDER | Currently free, no registration/key | Commercial use and storage permitted; redistribution follows every contributing license | Preserve `licenses`/`attributions`; credit OpenPOI and link attribution page; retain upstream agreement/notices |
| Overture Places | DISCOVERY_ONLY_PROVIDER | Public bulk data/catalog; no account for documented access | Permissive licenses vary by upstream source | CDLA-Permissive-2.0, Apache-2.0 and CC0 sources must remain distinguishable; preserve `sources[]` and applicable notices |
| BODIK WAPI | DISCOVERY_ONLY_PROVIDER (schema inventory here) | Public OpenAPI readable without key | Original resource terms remain separate; no universal grant inferred | Standard public-facility data is not smoking evidence; trace municipal resource first |

BODIK's [developer documentation](https://odcs.bodik.jp/developers/) documents `package_search` and DataStore; its [ODM description](https://odm.bodik.jp/about) identifies the national municipal metadata aggregator. The [WAPI manual](https://www.bodik.jp/project/bodik-api/bodik-api-manual/) and [ingestion rules](https://www.bodik.jp/project/bodik-api/bodik-api-info/) describe standardized datasets and license selection. Standard categories and accepted catalog license labels do not prove smoking-site geometry or original terms applicability.

The [CKAN API guide](https://docs.ckan.org/en/latest/api/) supports unauthenticated public GET searches. Each portal may impose its own access/terms policy; no authorization or content license is derived from CKAN's software license.

OpenPOI's [terms](https://docs.openpoiapi.com/legal.html) and [API reference](https://docs.openpoiapi.com/) confirm current free/no-key nationwide commercial search and storage with retained arrays. Its response source is representative, while licenses/attributions may combine multiple inputs. Some JFF points are geocoded from addresses; no freshness value is returned. Neither those points nor a generic host category is publisher smoking-coordinate authority. The documented aggregate gateway limit is 200 requests/second, burst 600; this tool uses a much lower rate. No client integration or user query/location forwarding is added.

Overture's [Places guide](https://docs.overturemaps.org/guides/places/) and [attribution page](https://docs.overturemaps.org/attribution/) distinguish source-specific permissive licenses; Places is not interchangeable with ODbL themes. The [quickstart](https://docs.overturemaps.org/getting-data/) documents public GeoParquet, bounded-area exports and STAC release discovery. We fetched STAC metadata only (`2026-09-23.1`); **no live Places rows were queried**. Local bounded exports are supported for later discovery/name-normalization/POI cross-check review. No bulk download or new DuckDB/Python dependency is installed.

`COORDINATE_HELPER` remains a separate role, blocked from canonical onboarding. No geocoder provider is registered, queried or connected. ADR-0011 decision 8 remains unapproved. OpenPOI/Overture coordinates never substitute for smoking-publisher coordinates.

## Bounded scan and worklist

| Scan | Requests in final report | Result |
| --- | --- | --- |
| BODIK ODCS/ODM, `title:*喫煙*`, up to two pages | 3 catalog requests | 6 unique exact resource candidates; no pagination remaining for this query |
| CKAN Tokyo + Minato, same query, one page each | 2 catalog requests | 3 candidates, all duplicate URLs already found via BODIK; not nationwide CKAN coverage |
| OpenPOI, `q=喫煙所`, `limit=20` | 1 request | 20 discovery-only POIs, 19 name/category keyword signals; truncation disclosed; no canonical candidates |
| Overture STAC | 1 request | Release metadata only; bounded Places export required |
| BODIK WAPI OpenAPI | 1 request | Endpoint inventory only; original resource review required |

Some final requests reused hash-verified cache from the initial probes, keeping original fetch dates. Initial query experiments made six catalog GETs: two broad OR probes, two plain-keyword probes, and two title-wildcard probes. The CLI then made five distinct catalog GETs (explicit start=0 on three portals, ODM start=20, and Minato start=0), for eleven unique catalog GETs total. Equivalent first-page URLs with/without start=0 account for two extra requests; later repeated runs used the cache. This was a bounded query-format investigation, not a crawling loop. Broad Japanese search tokenization also returned evacuation/statistics data, demonstrating why local smoking-resource screening is necessary.

The global human worklist is capped at **20: six unique resource URLs plus 14 discovery-only lead references**. API's 20 fetched POIs are not 20 exact official smoking datasets. Candidate URLs: two historical Taito CSVs (2023/2024), Koto station/park CSVs, and Minato designated-place CSV/JSON. Old catalog snapshots do not update the pinned Taito/Minato source releases or create a new source. Provider observations for duplicate URLs are preserved rather than overwriting license differences.

## Deep review (3 of at most 5)

| Path | Existence / rights / attribution | Coordinates / operation / maintainability | Decision |
| --- | --- | --- | --- |
| Koto park CSV | Official historical smoking list; current catalog CC BY label retained, not newly approved; Koto attribution | Fresh local payload check: 3 matching rows, latitude/longitude columns. Official [park prohibition](https://www.city.koto.lg.jp/470601/machizukuri/kasenkoen/sebi/jidouyuenkinen.html) still conflicts; no scoped exception established. Reachable CSV does not cure stale operation | BLOCKED; preserve existing `docs/SOURCES.md` exclusion |
| OpenPOI MIDORI Nagano 2F smoking-room lead | [Operator floor guide](https://www.eki-midori.com/nagano/guide/) has a smoking-space legend. OpenPOI record declares CDLA with Overture attribution; original operator smoking-publication reuse remains unknown | Exact returned 2F room/current use not independently established. No reviewed machine-readable publisher smoking-point resource. A POI point or floor-plan image is not numeric publisher authority | BLOCKED; operator lead only, no municipal source or map extraction |
| OpenPOI JFF Sanyo Auto “next to smoking room” lead | Food-business record name, not a dedicated smoking-place listing. Record declares PDL1.0/MHLW attribution; exact upstream smoking publication absent | JFF location may be address-derived, not smoking-site point authority. Current smoking operation unknown; no maintainable smoking resource established | BLOCKED; incidental keyword/host record is not permission |

[Current Koto smoking guidance](https://www.city.koto.lg.jp/380301/machizukuri/sekatsu/undo/45122.html) also distinguishes the three station smoking places; it does not approve the park CSV. MIDORI's [FAQ](https://www.eki-midori.com/nagano/faq/) is an ordinary operator page; general building opening times do not set smoking-room hours. We did not contact publishers or reinterpret missing reuse permission as consent. No raw official HTML/floor-map content is imported.

## Implementation and safety

`providers.mjs` exports provider identity/role/terms and `searchProvider`, `datasetMetadata`, `rightsMetadata`, `sourceAttribution`. CKAN reuses the extracted existing connector mapping, preserving publisher chain, exact resource ID/URL, license fields/override, and metadata/resource dates. Mixed smoking/prohibition datasets retain explicitly smoking-named resources for review; purely prohibited/statistical resources are excluded. Missing geometry stays unknown until resource inspection/human authority review.

All generated items are `publicationStatus=blocked`; smoking existence, coordinate authority and operation remain unknown. API access rights are never converted into human approval booleans. Generic POIs stay in `leads[]`; only catalog exact resources enter `resources[]`/manual-review queue. Onboarding preserves provider context and catalog observations while keeping its independent rights/evidence/coordinate gates. Noncanonical roles remain blocked even with an otherwise complete review packet.

CLI requires explicit cache/output paths, writes reports exclusively, and reuses existing public URL/redirect validation plus persisted 403/429 host stops. Defaults: 1.5-second per-host spacing, 15-second timeout, no retries, 2 MiB responses, one CKAN page of 20 datasets. Hard limits: three catalogs, three pages/catalog, 20 extracted candidates/invocation. Operator must retain the aggregate 20-entry/five-deep-review investigation budget; the CLI does not run an unbounded national crawl. WAPI/STAC paths are metadata-only, honestly labelled.

Tests use synthetic response fixtures plus small captured BODIK/OpenPOI subsets with source/hash/transformation notices. The single redistributed live POI subset declares CDLA only; agreement text and OpenPOI/upstream attribution accompany it. No live Foursquare/JFF row is committed. License arrays with malformed members fail closed rather than dropping obligations. API outage does not write source approval or change any registry.

No new source met all gates, so no adapter, source registry, canonical fixture/release, fresh ingestion or quality run is warranted. Public API/schema, DATA_DB/REPORTS_DB, account, Apple, resolver, promotion, tiles and production are unchanged.

## Reproduction and validation

From `services/api` (use fresh output names):

```sh
npm run discovery:providers -- --provider bodik --max-pages 2 --cache /tmp/provider-cache --out /tmp/bodik.json
npm run discovery:providers -- --provider ckan --catalog https://catalog.data.metro.tokyo.lg.jp --catalog https://opendata.city.minato.tokyo.jp --cache /tmp/provider-cache --out /tmp/ckan.json
npm run discovery:providers -- --provider openpoi --cache /tmp/provider-cache --out /tmp/openpoi.json
npm run discovery:providers -- --provider overture --cache /tmp/provider-cache --out /tmp/overture.json
npm run discovery:providers -- --provider bodik-wapi --cache /tmp/provider-cache --out /tmp/wapi.json
npm run source:onboarding -- --discovery-report /tmp/bodik.json --out /tmp/onboarding.json
```

New live results can differ; checked-in fixtures are the deterministic test contract. All six existing source baselines remain `LOCAL_PIPELINE_READY`; six imported catalog candidates remain `BLOCKED`. OpenPOI handoff imports zero new resources. Provider focused tests: 15 PASS; onboarding tests: 17 PASS. Node 24 `make api-validate` PASS (typecheck, 883 API tests, 93 discovery tests); `make contract` and `git diff --check` PASS. Actual provider/onboarding integration verified six existing baselines ready, six imported resources blocked, and the 20-entry/three-review limits. Independent code/security review found no P0/P1; the mixed-title P2 discovery miss was fixed with a regression test.
