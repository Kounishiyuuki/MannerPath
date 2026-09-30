# Nationwide deep follow-up — east / north / national (2026-10-01 JST)

Issue [#133](https://github.com/Kounishiyuuki/MannerPath/issues/133), child of #67. Codex implementation batch on `data/nationwide-deep-followup-east-national`, starting from #132 main `8b0ecb0c026d22acc914f02ae165a24cd6691bbc`.

## Result and review scope

**41 assigned groups; 39 deep-reviewed; 39 blocked; candidate 0; approved 0; implemented 0.** Two incomplete attempts are explicitly pending and excluded from the completed count. Condition B (at least 35 substantive reviews, all approvals implemented) is met. New sources/spots/prefectures/major cities: **0**. No fixture, registry approval, migration or canonical coordinate is added.

Assignment comes from the original 73 truncated groups, using manifest prefecture geography: Hokkaido, Tohoku, Kanto, Niigata, Yamanashi, Nagano, and the national group. Haneda is the only east operator in those 73; other already completed operator exclusions were not arbitrarily reopened. No west/central/south group is changed. The merged west report #134 labels Fukui as Codex-owned, but the task explicitly assigns Fukui to Claude; `pref-fukui` is therefore left untouched and is not included in our 41. That one follow-up remains in the west lane.

The original 190-target/215-raw/61-historical report remains unchanged. Exact prior inspections and SHA references were reused, including payloads retained only as historical attestations; those are not claimed as new raw reinspection. Follow-up inspected actual smoking inventories, public linked export routes/scripts, facility-category dictionaries, CSV/GeoJSON/SHP/XLSX contents and relevant terms/operation evidence. Catalog searches alone do not count as completed reviews. Each conclusion is limited to its named dataset/export path, not a claim that a jurisdiction has no eligible sources.

Machine-readable evidence and all unresolved gate fields: [deep-review attestations](nationwide-discovery/2026-10-01-east-deep-reviews.json); [batch summary](nationwide-discovery/2026-10-01-east-summary.json). The manifest and ignored resumable checkpoint retain orthogonal `deepReview` annotations; scan statuses remain discovery-only. Reports select a unique latest completed manual review per known target. Pending group attempts cannot enter completed or legacy keyword counts. Existing publication coverage comes only from reviewed source identities.

## Highest-value findings

- **Chuo:** followed official map → its explicitly linked JavaScript → literal `map_data.csv` URL. Actual UTF-8 CSV has 771 rows and 79 smoking-category records (`13007003000`) with lat/lng. All selected coordinates satisfy global bounds. Exact open-data terms are limited to listed page content; the 35-row open-data catalog omits this map export, while ordinary website policy prohibits unauthorized redistribution/adaptation. Its licensed public-facility CSV has 318 rows and zero smoking rows. **Rights blocked**, no inference from neighboring CC BY datasets. This is the most concrete remaining Tokyo coordinate candidate.
- **Shinagawa:** the official delegated GIS OpenData export exposes living-facility and culture/park CSVs. All 36 + 351 rows and their coordinate/category fields were inspected: zero smoking rows; host and park Points excluded. Ordinary smoking inventory remains PDF/external map evidence.
- **Itabashi:** three actual licensed mixed-facility CSVs total 23 rows, with no smoking Points. Host coordinates cannot substitute the separate smoking list.
- **Iwate:** 1,470 actual UD SHP records plus bundled category/equipment dictionary: 38 facility classes, 20 accessibility flags, no smoking class/flag. Publisher PRJ is JGD2000 Japan zone 10. No transformed host coordinates are imported.
- **Other prefectural raw:** Aomori smoking-rate statistical XLSX has no site geometry; Miyagi 118 facilities, Akita 351 GeoJSON features, Yamagata 156 public facilities, Fukushima 94 commercial records and Ibaraki 274 institutions do not establish smoking-site Points. Nagano restaurant-permit schema has no coordinates; permits are not smoking evidence. Niigata’s 971-entry dataset catalog has no smoking entry. The individual attestations limit each finding to the inspected rows/dictionary.
- **Current operation:** Toshima’s サンカクスクエア suspension, Sumida’s dated private-site trial, Niigata’s prior station-front closure and other construction/suspension notices cannot be overridden by catalog dates. Edogawa map lon/lat values position prohibition-area viewports, not smoking features.
- **Haneda:** linked floor JavaScript contains terminal centers and Platinumaps viewer/control messages, not a downloadable smoking-room Point feed. The owner’s policy requires prior approval for copying/distribution. Terminal centers and third-party map coordinates are excluded.
- **MLIT Shinjuku R2:** exact public terms/specification PDF previews were followed from publisher object tags. Terms permit reuse subject to third-party/excluded-content rights; archive-specific notices remain unreviewed. Attached 2018 specification uses **F024 smoking representative Point, F019 police box, F029 postbox**, unlike the older 2017 document. The standard/integrated SHP downloads require registration; actual Shinjuku feature counts/geometry/current-operation correspondence remain **unknown**, not zero. Prior Tokyo/Narita polygon-only research is reused without downloads/centroids.

## Pending attempts and resumption

- **Hokkaido:** targeted HARP search and exact 4.64MB 2018 facility CSV timed out. The accessible dataset schema describes host/building positions, warns about old/closed/incomplete facilities, and cannot establish smoking coordinates. Raw content remains uninspected; retry only through legitimate publisher access or a newly released explicit smoking dataset.
- **Yamanashi:** catalog follow-up found health/statistical report metadata; further primary prefectural access returned403 and that host stopped. Official-indexed rooftop/Kofu facility leads do not provide inspected eligible raw. Resume after publisher access is restored.

Remaining east/north/national candidates are the 39 specifically blocked routes plus these two pending attempts. Highest-value next work: establish publisher permission for Chuo’s exact 79-row coordinate scope; obtain MLIT Shinjuku through ordinary registered acquisition with raw hash/rights/current-feature correspondence; revisit ward/operator datasets only when explicit publisher Point exports become available. Do not repeat known host-only/polygon-only or reuse-forbidden raw without new evidence.

## Network and publication invariants

Existing FetchCache was used with per-host serialization, 1-second delay, 12-second timeout, one retry, cache/SHA verification and persisted host stops. Municipality/operator hosts were split between research tasks; shared portal hosts were coordinated. The new Koto geocloud and Yamanashi403 stops are retained; prior Tokyo catalog/BODIK stops remain. No bypass, credential operation, guessed private API, geocoding, centroid, Google/MapKit/OSM canonical coordinate or PDF/image coordinate estimation. Public PDF redirects were followed as exposed; expiring signed redirect URLs are omitted from committed evidence.

Source/evidence/identity/license/privacy policies are unchanged. Community #124 remains pending and blocked; no terms grant, registry approval or issue closure. Existing migration0021 and community/report/additive promotion behavior are retained. No remote D1, production deployment or Apple signing.

## Validation

| Check | Result |
| --- | --- |
| `make contract` | pass |
| `make api-validate` | pass:581 API tests +45 discovery tests, repeated after rebase onto west batch #134 |
| `services/api: npx tsc -p .` | pass |
| Discovery regression suite | pass; manual latest/dedup, pending exclusion, approval/coverage boundary, rescan retention |
| Fresh local SQLite/D1-compatible all-migration combined pipeline | 6 sources, 515 canonical, 513 published, 81 tiles |
| Quality | 14/14 pass |
| Promotion v3, fresh migrated target, deterministic re-export | pass, byte-identical |
| Cross-source generation | 0 candidates; no canonical mutation |
| Community regression | included in full API suite; blocked registry preserved |
| `git diff --check`; `git diff origin/main --check` | pass after rebase onto #134 |

No source passed approval, so new-source Wrangler D1 onboarding is inapplicable. The independent fresh local D1-shaped SQLite corpus check runs the real migrations and all existing sources; it is not reported as a remote or Wrangler production run.

## Assigned group results

Group | Completed | Verdict | Blockers
--- | --- | --- | ---
北海道 (`pref-hokkaido`) | no | pending | rawUnavailable, hostPointOnly
青森県 (`pref-aomori`) | yes | blocked | noSmokingEvidence
青森市 (`city-aomori`) | yes | blocked | noSmokingEvidence
岩手県 (`pref-iwate`) | yes | blocked | noSmokingEvidence, hostPointOnly
盛岡市 (`city-morioka`) | yes | blocked | noSmokingEvidence
宮城県 (`pref-miyagi`) | yes | blocked | noSmokingEvidence, hostPointOnly
仙台市 (`city-sendai`) | yes | blocked | hostPointOnly
秋田県 (`pref-akita`) | yes | blocked | noSmokingEvidence, hostPointOnly
山形県 (`pref-yamagata`) | yes | blocked | noSmokingEvidence, hostPointOnly
福島県 (`pref-fukushima`) | yes | blocked | noSmokingEvidence, hostPointOnly
福島市 (`city-fukushima`) | yes | blocked | coordinatesMissing, licenseUnknown
茨城県 (`pref-ibaraki`) | yes | blocked | hostPointOnly, noSmokingEvidence
水戸市 (`city-mito`) | yes | blocked | coordinatesMissing, currentOperationUnknown, incompatibleFormat
栃木県 (`pref-tochigi`) | yes | blocked | accessBlocked, rawUnavailable, noSmokingPoint
埼玉県 (`pref-saitama`) | yes | blocked | coordinatesMissing, currentOperationUnknown, reuseForbidden
さいたま市 (`city-saitama`) | yes | blocked | coordinatesMissing
千葉市 (`city-chiba`) | yes | blocked | coordinatesMissing, hostPointOnly
新潟県 (`pref-niigata`) | yes | blocked | noSmokingPoint, coordinatesMissing
新潟市 (`city-niigata`) | yes | blocked | coordinatesMissing, hostPointOnly
山梨県 (`pref-yamanashi`) | no | pending | accessBlocked, coordinatesMissing, currentOperationUnknown
長野県 (`pref-nagano`) | yes | blocked | coordinatesMissing, noSmokingEvidence
川崎市 (`city-kawasaki`) | yes | blocked | coordinatesMissing, rawUnavailable
相模原市 (`city-sagamihara`) | yes | blocked | coordinatesMissing
千代田区 (`ward-chiyoda`) | yes | blocked | coordinatesMissing, reuseForbidden
中央区 (`ward-chuo`) | yes | blocked | reuseForbidden, licenseUnknown
新宿区 (`ward-shinjuku`) | yes | blocked | coordinatesMissing, licenseUnknown
文京区 (`ward-bunkyo`) | yes | blocked | coordinatesMissing, licenseUnknown
台東区 (`ward-taito`) | yes | blocked | duplicateKnownResearch
墨田区 (`ward-sumida`) | yes | blocked | coordinatesMissing, licenseUnknown
江東区 (`ward-koto`) | yes | blocked | accessBlocked, coordinatesMissing, licenseUnknown
品川区 (`ward-shinagawa`) | yes | blocked | coordinatesMissing, licenseUnknown, noSmokingEvidence
中野区 (`ward-nakano`) | yes | blocked | coordinatesMissing, licenseUnknown
豊島区 (`ward-toshima`) | yes | blocked | coordinatesMissing, licenseUnknown
北区 (`ward-kita`) | yes | blocked | coordinatesMissing, licenseUnknown, redistributionBlocked
板橋区 (`ward-itabashi`) | yes | blocked | coordinatesMissing, licenseUnknown
練馬区 (`ward-nerima`) | yes | blocked | coordinatesMissing, licenseUnknown
足立区 (`ward-adachi`) | yes | blocked | coordinatesMissing, licenseUnknown, redistributionBlocked
葛飾区 (`ward-katsushika`) | yes | blocked | coordinatesMissing, licenseUnknown, redistributionBlocked
江戸川区 (`ward-edogawa`) | yes | blocked | coordinatesMissing, licenseUnknown
日本空港ビルデング（羽田空港） (`operator-haneda`) | yes | blocked | reuseForbidden, hostPointOnly, coordinatesMissing
国土交通省 屋内地理空間情報 (`national-mlit-indoor`) | yes | blocked | rawUnavailable, coordinatesMissing, currentOperationUnknown, licenseUnknown

Latest-main integration: rebased onto west/operator PR #134 main `b3bd86f11a70a8407f8ddcea43148000c487af8d`. Its research/report files are retained; both batches add no sources. No conflicts or migration renumbering were needed.
