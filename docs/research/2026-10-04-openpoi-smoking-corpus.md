OPEN DATA ROUTE:
**NOT VIABLE**

# OpenPOI / Overture nationwide smoking corpus — 2026-10-04

## Decision

**D. Neither is suitable for the requested hundreds-to-thousands automatic expansion today.** This is a measured yield/precision decision about these releases, not a rejection of the maintainer's open-data evidence tier. Directly named physical smoking places can support a future lower-confidence lane; a host/category alone cannot. OpenPOI is unsuitable as a canonical identity source. If a later release meets the gates, choose **C, direct Overture**, retaining OpenPOI only as optional discovery (B if that query layer is needed).

The minimum scale target used here is 200 strong candidates before dedupe, not 200 generic tobacco-related businesses. The final machine gate finds **93 Overture candidates**, not hundreds; **58 OpenPOI candidates**. Even their deliberately loose upper bound of 151 before cross-release dedupe cannot reach 200. None was imported or approved for publication.

| Foundation condition | Result |
| --- | --- |
| Sufficient smoking-place yield | FAIL: 93 direct-bulk / 58 API candidates |
| Machine-only precision acceptable | UNPROVEN: no independent labeled ground truth; name/context conflicts exist |
| License machine gate | Conditional feasibility: explicit record/provider license mapping works; delivery of license texts / NOTICE and registry approval remain |
| Stable identity | Viable design with Overture GERS crosswalk; no cross-release churn replay in this research |

Implementation stops at **research scripts and measurements**. No source adapter, evidence enum, migration, source approval, UI, ranking, deploy, remote D1, community #124 activation, OSM, Google/Apple canonical data, or CLUB JT extraction was added. No canonical IDs were minted and no spots were merged.

## Baseline and scope

The branch was refreshed from `origin/main` **after #165 and #166 merged**, base `0dc62c87250709cddd103d08ea8d807094e72a2c`. They were initially open; research reads continued while the prerequisite resolved. No Claude branch was changed.

Official comparison rebuilds the **six tracked reviewed source fixtures** through the real migrations, ingest, resolver, and publication gate in fresh in-memory SQLite: **513 published spots** (Taito 32, Osaka 344, Koto 3, Musashino 3, Minato 114, Kyoto 17). It is a pinned publication reproduction, **not a production database snapshot**; fixture-generated IDs are research references, not deployed favorite IDs. No existing local/remote DB was opened.

## OpenPOI: primary-source findings

[Official API reference](https://docs.openpoiapi.com/), [machine specification](https://api.openpoiapi.com/openapi.json), [terms updated 2026-10-03](https://docs.openpoiapi.com/legal.html), and [publisher attribution](https://openpoiapi.com/attribution.html) were checked. Commercial use and DB persistence are expressly permitted. Redistribution/modification remain subject to each contributing license. Preserve the record's full `licenses[]` and `attributions[]`, OpenPOI credit/link, and MannerPath change disclosure. MIT for the API does not license every POI as MIT.

The `Facility` response supplies `name`, `name_kana`, `prefecture`, `city`, `address`, `category`, `business_type`, WGS84 `lat`/`lng`, `level`, `source`, `licenses[]`, `attributions[]`. **No ID or stable upstream/GERS ID is exposed**; no verification date, provider record linkage, operating status or existence confidence is exposed. Source is a coarse label; merged attribution/license arrays do not reconstruct field lineage. `level` is geocoding granularity, not smoking-point accuracy. Category/business_type are normalized business categories, not a smoking-feature classification.

`/v1/search` accepts `q`, `center=lng,lat`, radius, bbox=`minLng,minLat,maxLng,maxLat`; limit is clamped to **1–200**. `count` is returned rows, not total hits. There is **no offset/cursor/page** in the specification. Multiple query words are OR; search spans names/kana/admin names/address, so an address match is not existence evidence. Public docs state shared **200 req/s sustained, 600 burst**, 429 on excess, no individual/API-key limit. Terms allow service/schema changes and interruption. Live nationwide storage is not an immutable downloadable snapshot.

The publisher advertises **3,372,487 total POIs**, approximately 2.49m Overture plus .88m food-permit rows. Its Overture input is pinned to **2026-08-19.0**; food permits rebuild weekly. These are publisher totals, not the number downloaded in this research.

### Retrieval and completeness

Run separate nationwide queries for 喫煙, 禁煙, 防煙, 灰皿, smoking, smoke, スモーキング, 喫烟, たばこ, タバコ, 煙草. A response with exactly 200 rows is treated as **possibly truncated even if there are exactly 200 matches**; recurse into four bbox children until every leaf is below the cap. Shared bbox boundaries are covered and exact raw response duplicates removed. Root envelope is 122–154°E, 20–46°N, covering Japan's remote islands. Depth 18 still saturated → unresolved, fails the completeness check. No silent cap acceptance.

Measured **15 requests**, **0 unresolved saturated cells**, **752 distinct raw records** across these terms. たばこ required subdivision. This is complete only for the API's current matching behavior and the chosen terms, **not all 3.37m POIs or all physical smoking places**. Coordinate-free records in a saturated API search cannot be proven recoverable by bbox subdivision; future saturation there requires a bulk source, not a claim of full coverage. Prefecture/municipality splits alone miss blank admin fields (common here), so recursive geometry is preferable; bulk remains best.

## Direct Overture

[Places schema](https://docs.overturemaps.org/schema/reference/places/place/), [taxonomy CSV](https://docs.overturemaps.org/taxonomy/2026-09-23.0/taxonomy.csv), [source schema](https://docs.overturemaps.org/schema/reference/common/source_item/), [Places access guide](https://docs.overturemaps.org/guides/places/) were checked. Release **2026-09-23.1**, taxonomy **2026-09-23.0 / schema v2.0.0**. September removed legacy `categories`; read `taxonomy.primary/hierarchy/alternates` and `basic_category`.

Taxonomy inspection of **2,302 rows** found no smoking-area/room/lounge category. Related categories (`tobacco_shop`, `smoke_and_vape_store`, `tobacco_company`, `smokehouse`, `hookah_bar`, `cannabis_dispensary`) do not establish a dedicated permitted smoking place and are not positive signals. A `place` feature is not itself a smoking-place feature. Names are therefore needed for candidate evidence rather than inference from hosts.

Bulk reads the immutable release's **16 GeoParquet objects**, object manifest/ETags retained in the JSON summary (10,996,226,026 bytes globally; this is not bytes downloaded). Bbox predicate lets Parquet prune row groups and columns; unlike an API result cap it has no pagination loss. Measured Japan-enclosing bbox: **3,434,081 records**. **2,914,402** have a JP address. The remaining bbox rows are not claimed to be Japanese: known non-JP country is excluded, unknown country held separately. A strict `addresses[].country = JP` subset is reproducible but not sufficient for coordinate-only Japan records; an approved non-OSM national boundary would be needed to admit missing-country records automatically.

The broad signal extraction (name tobacco/smoke/negative keywords OR tobacco/smoke/hookah taxonomy) yields **2,280 raw signal rows**, including **247 non-JP rows**. All main counts distinguish these three populations. Geometry's actual WKB Point is decoded for comparison; float bbox minima are **not** substituted for coordinates. Missing `operating_status` stays unknown (all 2,280 signal rows have NULL). Schema status `open` means continued operation, not open now; confidence estimates POI existence, not smoking permission or location accuracy. Source `update_time` means source update metadata, not on-site verification.

Direct bulk is superior to OpenPOI for release pinning, exact taxonomy, complete provenance, GERS identity, repeatable queries and updates. [Overture Places licensing](https://docs.overturemaps.org/attribution/#places) and its guide state Places contains no OSM data; this does not authorize other Overture themes.

## Strong signal gate and accuracy

`openpoi-smoking-name-research.v1` is a **candidate gate, never a publication gate**:

1. Structured smoking-specific feature/category would take priority, but no such taxonomy is present.
2. Require a physical noun phrase in normalized **name**: 喫煙所/指定喫煙場所/公衆喫煙場所/喫煙場所/喫煙室/喫煙ルーム/喫煙スペース/喫煙コーナー/喫煙ラウンジ/喫煙処/喫煙休憩室 or bounded `smoking area/room/lounge`.
3. Negative contexts win: 禁煙, 喫煙禁止, 路上喫煙禁止, 受動喫煙, 喫煙対策, 防煙, 喫煙防止, no/non smoking, smoke-free.
4. Food-permit source is not a smoking-feature source; vending/relative position (“喫煙所横/喫煙室前”), staff/factory context and conflicting venue categories are excluded. Direct Overture uses the full food/drink/lodging taxonomy hierarchy as well as exact categories. Known closed/non-JP/missing-country rows are excluded. Host-only records never pass.

This gate is intentionally conservative, so it also excludes some genuine venue-associated smoking places. It is not a recall estimate and does not infer private/staff access from every possible organization name. A new smoking taxonomy, explicit feature record or separately established source semantics could support machine adoption under the maintainer's decision without restoring official-only policy.

Actual false-positive **retrieval examples**: `禁煙Bar 4416 No Smoking Bar`, `Smoking & Non Smoking`, `Smoke and Grill Rivage` (food), `スパーク・喫煙具専門店`, food-permit `546：301249：山陽オート センターホール１Ｆ喫煙所横`, and staff/vending references such as `ハイアットリージェンシー京都Ｂ１ 従業員食堂内喫煙室`. These are rejected. Gate-positive names include school campuses, train platforms and shopping-mall rooms; names alone do not establish present access or currency. No per-place ground-truth verification was performed and **real-world false-positive rate is UNKNOWN, not 0%**. Ten adversarial name regression cases plus three license cases and a Point decoder check validate the classifier mechanics, not empirical precision. Exclusion fraction is not false-positive rate.

### Measured results

| Metric | OpenPOI | Overture direct |
| --- | ---: | ---: |
| Downloaded raw signal records | 752 | 2,280 |
| Strong name candidates | 58 | 93 |
| Excluded | 694 | 2,187 |
| Represented prefectures (resolved, non-unknown) | 18 | 25 |
| Unknown prefecture candidates | 1 | 1 |
| Exact duplicate candidates (same normalized name, ≤1m) | 0 | 0 |
| Near duplicate candidates (same normalized name, ≤100m) | 2 | 2 |
| Ambiguous (other official point ≤100m) | 1 | 6 |
| Clearly new relative to fixture baseline (>100m from all) | 55 | 85 |
| Independently confirmed truly new | **Unknown** | **Unknown** |
| Automatically publishable in this change | 0 | 0 |

Near duplicates include コリアンタウン喫煙所 and 城見緑道北喫煙所. 京都駅北側喫煙場所 is ambiguous against two official locations. Distance generates comparison candidates only: no automatic merge, no official evidence overwrite. >100m is a reproducible comparison classification, not proof of real-world novelty.

| Exclusion reason | OpenPOI | Overture |
| --- | ---: | ---: |
| No explicit physical-smoking name | 612 | 1,842 |
| Negative smoking statement | 38 | 28 |
| Food permit not smoking feature | 42 | 0 |
| Conflicting host/venue category | 2 | 70 |
| Non-JP address | 0 | 247 |

The JSON contains every prefecture/city/category/keyword/provider/license count, bounded candidate details and official comparison references. Administrative aggregation uses source prefecture/address, then an unambiguous municipality-name match against [Geolonia's mapping](https://github.com/geolonia/japanese-addresses); ambiguous/romanized names stay unknown. These are **research aggregations**, not canonical address enrichment or a spatial boundary check.

## License machine gate

Checked primary originals: [CC0](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en), [CDLA Permissive 2.0](https://cdla.dev/permissive-2-0/), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.en), [PDL1.0](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0), [Foursquare NOTICE](https://opensource.foursquare.com/places-notice-txt/). Treat API responses/tiles as redistribution of data, not license-free computational results.

| License | Commercial / modify / DB store / API / tiles | Attribution and changes | Text / NOTICE |
| --- | --- | --- | --- |
| CC0-1.0 | Yes, within rights waived/granted | No copyright attribution/change obligation; preserve provenance by policy | No NOTICE requirement; retain license reference |
| CDLA-Permissive-2.0 | Yes | Agreement itself does not mandate attribution/change notice; keep publisher provenance | Make agreement text available with shared data (§2.1) |
| Apache-2.0 | Yes | Preserve relevant copyright/attribution; prominent modified-file notice (§4) | Supply license copy and readable applicable NOTICE; Foursquare recommends full NOTICE in API developer docs |
| CC BY 4.0 | Yes | Creator/source/license links, supplied notices; identify modifications and retain earlier change indications (§3); database rights included (§4) | No Apache-style NOTICE; retain supplied rights/disclaimer information, no conflicting restrictions |
| PDL1.0 | Yes for scoped covered contents | Source; disclose editing and editor; do not present modified work as government's original | Third-party rights exclusions still apply; not blanket permission for every government webpage |

Provider+license pairing is checked on **every Overture source contribution**, including Overture's derived confidence contribution. No fallback assigns a missing license from memory. Unknown provider, absent/conflicting license, unscoped municipal terms, third-party exceptions or bespoke terms fail the future automatic lane. Registry review is per approved release/source policy, not per POI; the allowlist does not absolve terms changes. CC BY 2.x/3.x and vague `CC BY` are not auto-approved. OpenPOI's array values preserve original spelling; aliases must not silently collapse an unreviewed license.

Observed license incidences (multiple licenses can apply to one record):

| Population | CDLA | Apache | CC0 |
| --- | ---: | ---: | ---: |
| Overture raw signal | 2,280 | 251 | 115 |
| Overture strong | 93 | 2 | 0 |
| OpenPOI strong | 53 | 6 | 0 |

OpenPOI raw license spellings/counts, including CC BY/PDL variants, are fully listed in JSON. All strong rows pass **license-name compatibility**, not publication approval. All Overture raw contributions have explicit licenses; unknown-license records: 0. License columns are overlapping incidences, not a partition of record counts.

Existing `sources[].attributionText` can carry credits, source/license URIs and change notices. It does **not by itself** deliver a license copy/full applicable NOTICE with all API/tile/offline/promotion distributions. A future foundation must package reviewed license/NOTICE artifacts and make them available consistently in developer docs, API/tile clients and offline bundles. No current source registry entry or legal activation is created by this research.

## Identity, confidence and freshness proposal

[Official GERS stability policy](https://docs.overturemaps.org/gers/stability/) and [registry](https://docs.overturemaps.org/gers/registry/) make Places suitable for a **source natural key** `(overture-places, GERS id)`, mapped to an opaque stable MannerPath spot ID through a persistent crosswalk. Do not use OpenPOI name/location hashes as canonical IDs. Research raw-content fingerprints only remove identical API responses.

Pin each release, preserve upstream record IDs and field source paths, and reconcile changed coordinates through ADR-0009. GERS is a stability commitment, not immortality: rebrands, split/merge and large moves may change IDs; registry/changelog detects absence but does not provide every old→new relationship. Hold ambiguous changes and preserve existing canonical identity rather than mass-recreating IDs. Snapshot registry metadata when used because registry is mutable. No regional churn rate was measured here.

Propose `verification.existence: openData`, `evidenceQuality: openDataListing`, UI wording **「オープンデータ掲載」**. These names do not currently collide with the inspected vocabularies. They are **not implemented** and would require an accepted ADR-0012/ADR-0006 amendment, DATA_POLICY/SPECIFICATION/source-registry/contracts updates and client compatibility review before publication. Official/operator evidence remains authoritative for existing official spots.

Keep existence confidence and location precision independent: `publisherPoint` only for a publisher-supplied smoking-place point with established semantics; `areaApproximate` only with an approved area/host anchor under ADR-0017; otherwise `unknown` or held pending reusable anchoring. Overture geometry does not automatically prove the point is an exact smoking-room entrance. Never infer tobacco support, access, hours or `openNow` from category.

`lastVerifiedAt = null` unless a genuine smoking-place observation date exists. Release date, fetch/import date, GERS registry dates and `sources.update_time` remain release/provenance metadata. No freshness promotion from this research. `operating_status = open` never sets `openNow = true`; NULL never becomes false/closed. Closed-status gate is implemented in the research classifier but was not exercised by live NULL-only rows.

## Reproduction and validation

Raw/API responses, GeoParquet-derived cache and DB live **under /tmp**, not tracked. JSON records SHA-256 of response files and output artifacts plus exact source object manifest/release. S3 ETags are object fingerprints, **not claimed to be SHA-256 hashes**. API/Geolonia are live and can change; new runs must retain their own hashes and compare semantically rather than expect identical mutable-input hashes.

```sh
python3 -m venv /tmp/mannerpath-openpoi/venv
/tmp/mannerpath-openpoi/venv/bin/pip install duckdb==1.4.5
/opt/homebrew/opt/node@24/bin/node --experimental-strip-types --no-warnings \
  docs/research/nationwide-discovery/openpoi-official-baseline.mjs \
  /tmp/mannerpath-openpoi/official.json
python3 docs/research/nationwide-discovery/openpoi-smoking-research.py fetch \
  --cache /tmp/mannerpath-openpoi
/tmp/mannerpath-openpoi/venv/bin/python \
  docs/research/nationwide-discovery/openpoi-smoking-research.py bulk \
  --cache /tmp/mannerpath-openpoi
python3 docs/research/nationwide-discovery/openpoi-smoking-research.py analyze \
  --cache /tmp/mannerpath-openpoi \
  --output /tmp/openpoi-smoking-summary.json
python3 docs/research/nationwide-discovery/openpoi-smoking-research.py check \
  --cache /tmp/mannerpath-openpoi \
  --output /tmp/openpoi-smoking-summary.json
make contract
git diff --check
```

Node **24.21.0**, Python 3.9, DuckDB **1.4.5**. Passed research validation: JSON structural/count/hash checks, ten name and three license cases, and Point decoding; fresh official baseline replay; actual nationwide API and bulk retrieval; repeat analysis against immutable local inputs; contract and diff checks. Full API/typecheck/D1 promotion gates are unnecessary because no production foundation/model changes were made. Nationwide API scan reproduced the same 752-record count; bulk replay reproduced 3,434,081 bbox rows / 2,914,402 JP-address rows. Repeated analysis produced a byte-identical summary (`cmp`, exit 0). `make contract` and `git diff --check` passed. Reviewer findings on bbox-vs-Point precision and unknown-license accounting were resolved; the final summary was regenerated after mutable API replay and all artifact hashes passed.

## Handoff

**Human per-record review required? YES for adoption of this current unvalidated candidate corpus.** The finding does not impose manual review on a future evidenced, machine-gated open-data source. This run achieved nationwide measurement, not the desired scalable automatic publication route.

Claude Session: accept the measured D decision for this release window; decide whether the small corpus merits separate source-level semantics/precision validation, or prioritize reviewed official bulk with larger yield. Keep #124 independent. Do not reinterpret 85 baseline-distant names as 85 verified new places.

Claude Code CLI: use the exact bulk release/GERS candidates if a follow-up is authorized; establish independent sampling labels, coordinate semantics, cross-release identity replay and license/NOTICE packaging first. Only then propose the openData ADR/contract foundation. Do not activate automatic publication from this research, overwrite official evidence, or change Apple UI in this branch.
