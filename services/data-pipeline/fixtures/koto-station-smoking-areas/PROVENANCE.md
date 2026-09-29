# 江東区 公共喫煙所一覧（駅前） — reviewed first release

Retrieved unauthenticated from the official raw URL on 2026-09-29. Original bytes are
`131083_237_public_smoking_area_station.csv` (314 bytes, CP932/Shift_JIS, no transcoding).
SHA-256: `e36e81d58348db6607a374f18a77ae54801eb55b810fba2849cf49c14318126d`.
`fetch.json` retains only release evidence metadata; no cookies or credentials.
`catalog-evidence.json` is a selected, verbatim-value metadata snapshot from the
[official package API](https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t131083d0000000061).
It intentionally shows both resource URLs so the excluded sibling cannot be confused with the
approved file. Neither catalog timestamps nor HTTP Last-Modified establish observation time.

## Primary-source review (2026-09-29)

- Publisher: 江東区; dataset maintainer 環境保全課.
- [Ward publication delegation](https://www.city.koto.lg.jp/012107/koto_opendata.html)
  directs users to the Tokyo catalog and its terms. This establishes the catalog as the ward's
  publishing site, rather than treating a third-party metadata label as approval.
- [Dataset](https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000061):
  公共喫煙所一覧, package `t131083d0000000061`, explicitly CC-BY-4.0, no resource-specific exception.
  HTML retrieval returned 403; the publisher's unauthenticated package API above supplied the
  license declaration and exact resource binding. The [official API specification](https://spec.api.metro.tokyo.lg.jp/spec/t131083d0000000061-92c2953f65301ce61a07fc513ab38f15-0)
  independently binds station CSV, 江東区 and CC BY.
- [Raw station CSV](https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv).
- [Applicable Tokyo terms](https://portal.data.metro.tokyo.lg.jp/terms/), §2:
  CC BY 4.0 except annotated content; redistribution, commercial reuse and modification permitted.
  §2(1)(イ) requires changed-content disclosure and no appearance of government authorship.
- [CC BY 4.0 legal code](https://creativecommons.org/licenses/by/4.0/legalcode.ja),
  §2(a)(1) permits sharing and adaptation; §3 requires credit, source/license URI, notices and
  modification disclosure. No share-alike; §2(a)(5) prohibits conflicting downstream restrictions.
- Attribution follows Tokyo's modified-work example, credits 東京都・江東区 and the resource
  title, includes the exact raw URL, license, change notice and linked terms/disclaimer.
  The byte-identical public wording lives in `KOTO_ATTRIBUTION_TEXT` and `docs/SOURCES.md`.
- Geographic scope: three station-front public smoking locations in 江東区, partial ward coverage.
- Cadence: publisher package says 随時, no guaranteed interval/SLA. Resource metadata date
  2025-03-17 JST and HTTP Last-Modified 2026-01-15 are not evidence dates. `observedOn = null`.
- Current-operation check: [ordinary ward smoking page](https://www.city.koto.lg.jp/380301/machizukuri/sekatsu/undo/45122.html),
  updated 2026-02-04, identifies the same three sites. Used only for conflict/current-operation
  review, never as a licensed value source. No material contradiction found for station rows.

## Mapping and uncertainty

| Column | Mapping |
|---|---|
| 緯度 / 経度 | Explicit decimal latitude/longitude of each named smoking site, used directly without geocoding. Datum, positional accuracy and entrance semantics are **not declared** in publisher CSV/catalog/spec. The existing canonical display-lat/lon convention treats the supplied points as WGS84-compatible; this is an implementation assumption, not a publisher assertion or survey-precision claim. |
| 喫煙所名 | Verbatim name and direct existence/lifecycle evidence from a smoking-location-only resource; a host name alone never suffices. |
| 場所 | Retained verbatim in raw evidence only; not converted to host/access/entrance data. |

All three raw rows become immutable observations, source entities and spots. No publisher stable ID
exists; upstream row ref is NULL. Hours, tobacco support, physical type, host, access, environment,
fee and evidence observation date remain unknown. No added field comes from the ordinary HTML.
Exact header/width, explicit smoking-location names and finite coordinate ranges fail closed.
Canonical resolution additionally requires the exact reviewed hash, station URL, NULL observation
date and three observations. Future bytes need a new repository review. `crossReleaseValidated=false`,
`completeness=partial`, no natural key and no `refreshTarget`.

## Excluded park sibling

`131083_237_public_smoking_area_park.csv` is **blocked and not ingested**. Its three park listings
conflict with the [official all-ward-park prohibition](https://www.city.koto.lg.jp/470601/machizukuri/kasenkoen/sebi/jidouyuenkinen.html)
(2024-11-01 page, prohibition effective 2022-01-01). Clear licensing alone does not establish
current permission. Publisher clarification/current exception evidence is needed; do not copy
park rows into this station fixture or widen this adapter.
