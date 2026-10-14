# Nationwide external data providers — reuse feasibility (2026-10-14)

Baseline `origin/main` `f6ddf4e`. Research only: no source registered, no data imported, no schema, API, tile or
Apple change, no Cloudflare/remote D1 operation. Network use here: four read-only requests to moqlog (the embed guide,
the site policy, one category lookup `search=金沢`, one `places?term=5957` for 金沢駅) plus web search/fetch of public
pages. Raw responses stay outside the repository; only field names and aggregates are recorded.

This is an engineering review, not legal advice. A right that a provider's terms do not state is recorded as
**未確定 / not granted**, never as allowed.

## 1. Result

**No external provider can be imported into the canonical database today.** The fastest lawful route to real
nationwide volume remains first-party publishers (municipal open data, airports, railway/facility operators) through
the existing gates; external services can at most feed a **discovery-only lead queue** that a human turns into
first-party evidence. Highest-value next action: **ask moqlog for written permission** (§6), because its public API is
the only one found that is organised nationwide by station and returns per-record coordinates — but even with
permission its records are leads, not evidence (§3).

## 2. Comparison

| Provider | API / docs | Reuse terms (evidence) | Coordinates | Freshness / closure | Fit with ADRs | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **moqlog 喫煙所マップ** | Public JSON `GET /smoke/wp-json/moqlog/v1/places?term=<id>` (≤100 per station/facility) and ID lookup `wp/v2/categories?search=`; script widget. [Embed guide](https://moqlog.jp/smoke/embed-guide/) | No licence, no 利用規約. [Site policy](https://moqlog.jp/policy/): "Copyright © 2016-2026 … All Rights Reserved", no warranty, may stop without notice. Guide: avoid bursts, honour `Cache-Control`, large map delivery needs own infrastructure; data-use enquiries via [contact](https://moqlog.jp/contact/). Commercial use, app use, D1 storage, offline cache, modification and redistribution: **not stated → not granted** | `latitude`/`longitude`; response `notice`: 「登録座標は施設の代表点の場合があります。」 Guide: do not use for exit distance / walking time | `verified_at`, `status` (e.g. `uncertain`), `place_verified`; `source` field | AGENTS.md: third-party discovery is not provenance; ADR-0017 forbids unreviewed anchors | **Contact required**; discovery-only even if granted |
| **OpenStreetMap / Overpass** | Overpass API; Taginfo | ODbL 1.0, share-alike; [ADR-0010](../adr/0010-osm-odbl-production-architecture.md): legal review required, architecture A rejected | Node or way centre; no precision field | Edit timestamps ≠ site check | ADR-0010 blocks; public Overpass from clients forbidden (AGENTS.md) | **Blocked** (≈1,046 strict candidates in Japan, [2026-10-04](2026-10-04-osm-smoking-viability.md)) |
| **OpenPOI API** | [docs](https://docs.openpoiapi.com/) | Commercial use and storage permitted; redistribution follows each contributing licence ([terms](https://docs.openpoiapi.com/legal.html)) | Geocoded/representative; `level` is geocoding granularity | No freshness, no stable ID | Not smoking evidence | **Discovery-only** (58 strong candidates, [2026-10-04](2026-10-04-openpoi-smoking-corpus.md)) |
| **Overture Places** | GeoParquet, [guide](https://docs.overturemaps.org/guides/places/) | Per-source permissive licences ([attribution](https://docs.overturemaps.org/attribution/)) | Business representative points | Release-based | Not smoking evidence | **Discovery-only** (93 candidates) |
| **CLUB JT 喫煙所MAP** | Member app/site; no public API found | Terms not reviewed here; JT-held data plus user posts ([Impress Watch](https://www.watch.impress.co.jp/docs/news/1233696.html)) | Unknown | User posts | Tobacco-maker service: brand/promotion risk under product rules; earlier research excluded extraction | **Not pursued** without a JT data agreement |
| **喫煙所情報共有マップ** (合同会社ファービヨンド) | No API mentioned ([release](https://www.dreamnews.jp/press/0000352757)); service URL in the release returned 404 on 2026-10-14 | No terms found | Unknown | User posts + public info | User-generated, mixed provenance | **Not viable** today; contact only if terms appear |
| **Municipal open data (BODIK, CKAN, 東京都 API portal)** | CKAN `package_search`, [BODIK](https://odcs.bodik.jp/developers/); [東京都 API](https://spec.api.metro.tokyo.lg.jp/) (e.g. 江東区 公共喫煙所一覧) | Per resource (often CC BY 4.0); catalog licence ≠ content licence | Publisher points or area | Publisher dates | Existing canonical path (ADR-0006) | **Use**: existing pipeline ([2026-10-08](2026-10-08-open-provider-discovery.md)) |
| **Airports / railway / facility operators** | Web pages, no APIs | `factReference` facts with reviewed anchors (ADR-0018) | Area approximate (ADR-0017) | Page dates | Accepted path | **Use**: 7 airports implemented ([2026-10-14](2026-10-14-nationwide-airport-expansion.md)); stations next |
| **MLIT / GSI 屋内地図** | Registered download | Open terms per dataset | Indoor polygons | 2019–2021 | Blocked on authenticated acquisition | **Low** ([2026-09-30](2026-09-30-mlit-gsi-f019-smoking-poi.md)) |

## 3. moqlog technical check (one station, read-only)

Response envelope: `term`, `url`, `places[]`, `limit` (100), `possibly_truncated`, `notice`. `Cache-Control: public,
max-age=300`. Record fields: `id`, `name`, `url`, `address`, `exit`, `status`, `place_verified`, `latitude`,
`longitude`, `paper`, `heated`, `paper_status`, `heated_status` (`allowed`/`not_allowed`/`unknown`), `type_source`,
`type_verified_at`, `source`, `verified_at`.

金沢駅 (`term=5957`), 2026-10-14: 7 records, `possibly_truncated=false`.

| Measure | Count |
| --- | ---: |
| `place_verified = true` | 0 |
| non-empty `source` | 0 |
| non-empty `verified_at` | 1 (status `uncertain`) |
| tobacco types known | 0 |
| hosts that are venues (hotel, shopping building, bar) rather than named smoking places | 4 |
| named station smoking places (東口①②, 西口) | 3 |

Implications:

- **Coordinates are host representative points unless proven otherwise** (the API says so). Under ADR-0017 they
  cannot even be anchors (unreviewed third-party POI values).
- **No per-record first-party source** in this sample, so no record can be traced to evidence automatically.
- One listed host (金沢フォーラス) is a building where earlier first-party review found no smoking evidence
  ([2026-10-11](2026-10-11-ishikawa-location-precision-reevaluation.md)); hosts are not evidence (AGENTS.md).
- The three Kanazawa station records are useful **leads** for the already-open 金沢駅 東口/西口 rows, which are blocked on
  a first-party (city) statement, not on discovery.
- Nationwide count and regional coverage are **unknown**: measuring them needs enumeration of every station, which
  is the bulk retrieval this review does not do without permission.

## 4. Coverage expectation

| Route | Realistic national yield | Basis |
| --- | --- | --- |
| Municipal open data | Concentrated in large cities (Tokyo wards, Osaka, Kyoto) | Existing sources, 513+ spots |
| Airports / stations (`areaApproximate`) | Every prefecture can get airport/major-station coverage | ADR-0018 path; 7 airports done |
| OSM | ≈1,046 candidates, blocked | ADR-0010 |
| OpenPOI / Overture | < 200 strong leads | 2026-10-04 |
| moqlog (if permitted) | Unknown; station-organised, so likely broad but host-level | §3 sample |

Kanazawa specifically: no city open data was found by search on 2026-10-14; the city source is rights-blocked and
the station rows wait for a city statement (2026-10-11).

## 5. Integration design (no implementation)

Keep external records out of the canonical database:

- A separate, internal **lead table** (pipeline-local, never in `DB` tiles or `/v1`) holding provider, provider
  record ID, fetch time, terms version, raw coordinate with `coordinateKind = hostRepresentative | unknown`, and a
  review status. No lead is ever published.
- Review turns a lead into a canonical spot only by finding **first-party existence evidence** and a reviewed anchor
  or publisher point; the canonical row cites that first-party source, not the provider.
- Publication gates (ADR-0006, ADR-0012, ADR-0017, ADR-0018) are unchanged. Any credentialed provider goes through
  the Worker proxy only (ADR-0020); no client calls a provider.
- Storing even leads requires the provider's written consent where the terms are silent (moqlog).

## 6. Enquiries needed

| Provider | Contact | Questions |
| --- | --- | --- |
| moqlog | https://moqlog.jp/contact/ | (1) May MannerPath, a free iOS/watchOS app, fetch the public API server-side and store results for internal review? (2) May derived facts be shown in the app or stored in Cloudflare D1 / offline caches? (3) Required credit text and link? (4) Acceptable request rate and total enumeration? (5) What does `source`/`place_verified` mean, and is a first-party source kept per record? (6) Are coordinates host points or smoking-place points? (7) How are closures recorded? |
| 喫煙所情報共有マップ | https://far-beyond.biz/ | Is there a terms page or data licence; is any API offered? |
| CLUB JT | JT enquiry form | Only if the product owner accepts a tobacco-maker data source; licence for location facts without branding |
| 金沢市 (環境政策課 等) | City enquiry | Publication of the station smoking places with a reuse licence (unblocks 金沢駅 東口/西口) |

No message has been sent.

## 7. Recommendation

1. **Continue first-party expansion** (stations after airports, ADR-0018) — the only route that publishes now.
2. **Send the moqlog enquiry** (§6). With written permission, use it as a discovery lead source (§5), never as evidence.
3. Ask 金沢市 directly for the station smoking places; this fixes the Kanazawa gap that triggered this review.
4. Keep OSM, OpenPOI, Overture, CLUB JT and user-generated maps out of publication.
