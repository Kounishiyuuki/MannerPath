# 武蔵野市 公衆喫煙所 — reviewed first release

Primary-source review: Codex, 2026-09-30; Issue #113. This N2 exception covers three heavily
used station areas (吉祥寺・三鷹・武蔵境), with publisher-supplied smoking-site points and
an explicit resource-level license. It does not claim nationwide or citywide completeness.

## Approval gate

| Item | Reviewed evidence / decision |
|---|---|
| Publisher / owner | 武蔵野市; 地域生活環境指標 publication, municipal planning/open-data publishing |
| Source ID | `musashino-public-smoking-areas` |
| Dataset title | 4(2)トイレおよび路上禁煙エリア・公衆喫煙所 令和4年版地域生活環境指標 |
| Dataset URL | https://www.city.musashino.lg.jp/shiseijoho/tokeishiryo/chiikiseikatsu_kankyoshihyo/1040384/1040390.html |
| Raw URL | https://www.city.musashino.lg.jp/_res/common/opendata_kikaku/toilet.zip |
| Exact license | Creative Commons Attribution 4.0 International (CC BY 4.0) |
| License URL | https://creativecommons.org/licenses/by/4.0/deed.ja ; legal code https://creativecommons.org/licenses/by/4.0/legalcode.ja |
| Applicability | The exact item 4(2), in the same section as its ZIP download, states this work is licensed CC BY 4.0 and links the license. `license-evidence.html` retains this scoped publisher excerpt. No license is inferred for ordinary city HTML or another dataset |
| Redistribution / derivation | Both permitted by CC BY 4.0 §2(a)(1), including commercial reuse, subject to §3 attribution, license/source links, notices and change disclosure |
| Share-alike | None. No endorsement and no additional conflicting restrictions (§2(a)(5)); source content remains under its applicable rights |
| Attribution | Credit 武蔵野市, supplied title, exact dataset/raw URLs, CC BY 4.0 URI, extraction/normalization notice. Byte-identical client wording: `MUSASHINO_ATTRIBUTION_TEXT` in the adapter |
| Coordinates | Publisher explicitly describes KML as WGS1984 latitude/longitude. Each selected Placemark is its own smoking-site Point, supplied lon,lat,zero altitude. Not CSV projected coordinates, park/building centroids, geocoding, inferred entrance or surveyed precision |
| Geographic scope / completeness | Three named station public smoking sites in 武蔵野市; partial. Current official page also lists a newer 吉祥寺イースト location absent from the licensed fixture, so it is excluded |
| Included | Exact reviewed `#inline3` layer AND explicit 名称 ending 喫煙所 AND one valid Point; 3 records |
| Excluded | 4 road-smoking-prohibition polygons (`#inline0`), 14 park toilets (`#inline1`), 4 toilets (`#inline2`); no restaurants, retailers, convenience stores or inferred ashtrays |
| Observation semantics | No exact observation date stated. Title's 令和4年, page update, fetch date and HTTP Last-Modified are not observation dates; `observedOn=NULL`, `lastVerifiedAt=NULL` |
| Cadence / retrieval | Published as annual indicator edition; no automated update SLA established. Stable public ZIP GET, deterministic member extraction and pinned schema/hash. First release only; no `refreshTarget`, `crossReleaseValidated=false` |
| Current operation | https://www.city.musashino.lg.jp/gomi_kankyo/gomi/bunbetsu_kaishu_torikumi/event_gomisogotaisaku/1026528.html (updated 2026-04-08) lists the same three names and addresses; no location/closure contradiction found. Used only for current-operation/conflict review, not canonical values. Its changed hours and newer fourth site are not copied |

## Immutable retrieval

`fetch.json` retains GET metadata (2026-09-29T16:10:07Z), byte counts and hashes.
HTTP Last-Modified: Tue, 18 Apr 2023 04:43:38 GMT. No credentials or cookies.

- `toilet.zip`, unchanged upstream archive, 13232 bytes, SHA-256
  `3cc620efb082a2b6ee1f30b757dd35d26691924d427dc0c4812d654e009b3f5c`.
- Archive member `KML/トイレおよび路上禁煙エリア・公衆喫煙所.kmz`, SHA-256
  `b686c4dd049d297bc6dfc7a0facd62855b35a8a089e4d1479d421e60ff8b2028`.
  ZIP legacy filenames decode CP932 (Python ZIP's CP437-decoded name can be
  recovered with `.encode('cp437').decode('cp932')`).
- KMZ's `doc.kml`, byte-identical extracted fixture, 28067 bytes, SHA-256
  `fc6986b986ec315691299a12583f14a8fd942e34075fd1e9e44837dc72c57a7c`.
  UTF-8 XML; 25 Placemarks retained as immutable raw rows, 3 observations/spots.
  No coordinate projection, serialization or transcoding occurs in extraction.

Selected publisher identities/points:

| 番号 | 名称 | 所在地 (raw only) | Longitude | Latitude |
|---|---|---|---|---|
| 1 | 吉祥寺駅喫煙所 | 吉祥寺南町１－２ | 139.58007563093057 | 35.7021543595292 |
| 3 | 武蔵境駅喫煙所 | 境南町２－１ | 139.54285740368346 | 35.70180990186404 |
| 2 | 三鷹駅北口喫煙所 | 中町１－１６ | 139.56127985646458 | 35.70370762600757 |

Existence/lifecycle are the explicit licensed public-smoking layer, checked against current city
operation evidence. Name and location provenance point to their exact XML fields. Hours, openNow,
tobacco support, access, physical type, indoor/outdoor, host, fee, floor and entrance remain unknown.
The source-specific reader refuses XML entities/DTD, unknown styles, schema/count drift, non-Point
smoking geometry, invalid/reversed/out-of-city coordinates and duplicate IDs/points. Resolution
additionally requires the exact reviewed SHA, raw URL, NULL observation date and 3 observations.
Future bytes cannot publish without another repository review.
