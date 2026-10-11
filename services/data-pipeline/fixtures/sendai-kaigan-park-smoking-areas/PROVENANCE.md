# 仙台市 海岸公園（井土地区）内喫煙所 — reviewed first release

Codex source, original-terms and anchor review, 2026-10-11, #137 / #113 follow-up. User explicitly authorized repository onboarding and commit after review; no production approval, execution or rollout is implied.

## Original publication and rights

Publisher: 仙台市. [Public facility dataset explanation](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_example.html). [Original CSV](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/documents/041009_public_facility.csv): 1,177,923 bytes, UTF-8 BOM, 2,844 data rows, SHA-256 `c6bf5395eed995773e3b74b6d3ba6ea3868940f45a6293b8d37330f2bdd72c8b`. Original bytes are preserved verbatim. `fetch.json` contains acquisition metadata; none is an observation date.

The official catalog's exact CSV result labels the license CC BY 4.0 International. `rights-review.json` binds resource, search response fingerprint, license label, baseline and publication date. [Original city license guidance](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata.html) applies individual CC licenses and requires checking latest conditions; it disclaims accuracy/completeness. [CC BY 4.0 legal code](https://creativecommons.org/licenses/by/4.0/legalcode.ja) §2 permits sharing and adaptation, including commercial use; §3 requires attribution, license reference, notice retention and modification disclosure. No share-alike is imposed. Do not imply endorsement. Catalog license is resource-specific, not a grant for external pages or images.

Attribution sent by the adapter identifies 仙台市, 公共施設一覧, original CSV URL, CC BY 4.0 license link, and MannerPath's extraction/normalization and approximate-area treatment. Source notices are retained in this provenance record. Images and linked-site material supply no published fields.

## Scope and existence

Only row ID `000000001388`, named 海岸公園（井土地区）, with its reviewed explicit smoking-amenity description qualifies. All 2,844 rows stay immutable raw evidence; 2,843 rows create no observations. Host/facility existence alone is never enough. One approximate park-level result represents the CSV's amenity statement; no separate smoking places or exact pins are synthesized from the operator's two-place diagram.

## Current operation

The same publisher row links the [designated operator homepage](https://bouken-asobiba-net.com/bouhiro/). On review it contains an October 8, 2026 current notice and an explicit smoking-area annotation in the park diagram. `operation-checks.json` records status/hash and limited review conclusions. No closure or prohibition was found in the inspected homepage body. This is current primary corroboration, not a field observation; no new observation timestamp is minted. Operator page values, text, diagrams, hours and individual locations are not copied into canonical data. The April 1 baseline and May 13 publication are kept separately; `observedOn=null` and `lastVerifiedAt=null` conservatively avoid promoting them into smoking-observation dates.

## Anchor and precision review

The same CSV row names the park and publishes `緯度` / `経度`. The reviewed mapping reads only these header columns and `名称`. The point is accepted as the publisher's representative park location, not the position of a smoking area or a surveyed entrance. Decimal coordinate interpretation is WGS84-compatible for display; datum/accuracy/entrance semantics are not declared and no surveyed accuracy is claimed. No screenshot, Google/Apple/OSM coordinate, geocoding, centroid computation or manual point is used.

The anchor binds this source, exact release digest and upstream row. `recordAreaAnchor` re-reads and checks its coordinates against the immutable row before resolution. `anchoredObservation` supplies the independent existence provenance plus area-anchor location provenance. Database authority and DTO serialization must produce `locationPrecision=areaApproximate` and `locationArea={kind:park,name:海岸公園（井土地区）}`. Missing or changed anchor evidence blocks resolution. The existing Apple approximate-location presentation is used without any exact-point upgrade.

## Unknowns and release gate

Park fields `利用可能曜日`, `開始時間`, `終了時間` are never smoking hours: observation hours are `none`, so open-now remains unknown. The operator's different facility hours do not overwrite these unknowns. Tobacco type, smoking environment, access conditions and spot subtype remain unknown. No positive inference follows from free park parking or public-facility status.

This is a pinned, partial first release. Changed bytes/URL/scope require fresh review; no refresh target, complete-coverage claim, automatic second release or cross-release matching is enabled. The natural publisher row ID is release-scoped, not a cross-release identity promise. Repository onboarding and local fixture/test publication are distinct from production publication; no production state is changed.
