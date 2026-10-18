# Tokyo major-station source gates — 2026-10-18

## Preservation note — 2026-10-18

This report and its JSON evidence ledger are preserved as the original research snapshot,
not a current adoption decision. No source investigation or baseline replay was rerun for
preservation; the original observations and ledger remain unchanged.

- [PR #291](https://github.com/Kounishiyuuki/MannerPath/pull/291) directly re-evaluates
  these candidates and challenges the original Chuo datum and missing-anchor blockers.
  Its later status note also tracks follow-up PRs #292, #293 and #295. Consult that review
  for subsequent decisions; the historical `READY 0` below must not override them.
- [PR #294](https://github.com/Kounishiyuuki/MannerPath/pull/294) expands the scope to
  Tokyo-wide bulk acquisition routes. Municipal-list and address-anchor topics overlap;
  its broader estimates are not additional discoveries or approved spots from this ledger.
- The Markdown is the narrative report; the JSON is its supporting evidence ledger,
  not a separate survey. Asakusa's ten baseline results are existing records, not additions.

Both PRs were open when checked for preservation. This archive does not approve sources,
merge those proposals, or authorize publication, production writes or publisher contact.

**READY new spots: 0. No onboarding implementation or source approval.**
Research branch: `research/tokyo-v1-major-station-sources`, based on
`ea54c9c814776c0bc77ade5815b35d87a4ae8b1e` (origin/main fetched for this task).
Checked 2026-10-18 JST / 2026-10-17 UTC. Exact successful retrieval times, URLs,
whole-response hashes, station features and counts are in the [evidence ledger](2026-10-18-tokyo-major-station-sources.json).
Hashes identify observations, not a licence or continued operation guarantee. Raw ordinary
HTML/PDF/map files stay in private temporary research storage, outside this repository.

## Decision and scope

Only Chuo, Shinjuku, Shibuya, Toshima and Taito are in this batch. Tokyo station itself is
in Chiyoda; the Chuo candidates cover its Yaesu side, not a claim of full Tokyo station coverage.
No Apple/Google/OSM/blog result supplies existence or coordinates. Maps embedded in municipal
pages were not harvested. Host presence does not create smoking evidence. Unknown tobacco
support, access or hours stays unknown; an operation check is not a site visit.

The latest DATA_POLICY and accepted ADR-0018 supersede old blanket HTML/copyright blocks:
ordinary first-party facts may qualify under a recorded factReference review (D-R), while
express information-use restrictions fail closed. Downloadable files still need their own
resource-level rights. Neither this research nor a draft permission-request letter is approval.
No relevant granted reply was located in the versioned research inspected; no mailbox was
read and no new publisher contact was made. No community/OSM publication gate is changed.

### Station screening and duplicate exclusion

| Station definition | Existing baseline within 1km | READY additions within 1km | Blocked candidates within 1km | >=3 new additions achieved? |
| --- | ---: | ---: | --- | --- |
| Tokyo / JR Tohoku station lines | 0 | 0 | Uncertified: smoking coordinates / reviewed anchors unresolved | No |
| Shinjuku / JR Yamanote station lines | 0 | 0 | Uncertified | No |
| Shibuya / JR Yamanote station line | 0 | 0 | Uncertified | No |
| Ikebukuro / JR Yamanote station line | 0 | 0 | Uncertified | No |
| Asakusa / Tokyo Metro Ginza station line (not TX) | 10 | 0 | No new selected resource rows | No; existing coverage already >=3 |

These counts reproduce **six pinned sources / 513 published spots / 81 tiles locally**,
not a remote production census or an assertion that all 15 reviewed adapters are deployed.
The ordinary pipeline was run in an in-memory SQLite D1-shaped database with real migrations,
`importProductionBaselineSources`, `publishTiles` and `v1TileRows`; no remote D1 was used.
Current Taito CSV is byte-identical to the pinned 34-row release, hash `5123ee41251bf22ebacfbcaee5d781c883ad8823f8861c4824a3deff012c6c74`.
Its 32 published records are already included in the 513. The other two are existing
withheld records, not new discoveries or candidates to reactivate. New Chuo/western names
are not an exact-name/municipality reimport of this six-source set; no new source can be
accepted merely because it is absent from that set. Dedup of a future accepted source must
also inspect current canonical/withheld entities, source identity and nearby positions.

The analytical center is a segment-length-weighted mean of the selected official N02-25
station line midpoints (all features of the declared station/line/operator), with Haversine
R=6371008.8m and <=1000m filtering before rounding. The ledger retains the exact features,
archive checksum, processed-data attribution and method. MLIT publishes JGD2011 line geometry,
**not an official entrance/center Point**; the center is our research computation, never a
canonical smoking anchor. The older two-decimal campaign seeds (roughly ±500m) are unsuitable
for this exact radius question. Asakusa TX is a separate station; do not combine or sum it.

Existing Asakusa results: four Sensoji places, Sumida park, Matsuba park, Senzoku park,
Riverside Sports Center, Seven-Eleven Tawaramachi and SMOCO (names/distances/retained hours
in ledger). All are duplicates for this task. North/temple side dominates; the westward
Tawaramachi and near-river places provide some spread. Matsuba (~951m) and Riverside (~983m)
are boundary-sensitive, not guaranteed <=1km walking routes. Sensoji's four existing
publisher points are distinct; do not replace them by a new common temple anchor.

## Chuo / Tokyo: separate smoking facts from licensed park anchors

Primary current smoking list, dated 2026-10-13:
https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html

| Candidate | Status / new publishable count | Existence, operation and intended location meaning |
| --- | --- | --- |
| 楓川久安橋公園 | BLOCKED / 0 | Current designated smoking location; smoking supply hours 0:00–24:00 confirmed in currently linked PDF. A separate licensed CSV has the same park name/address and a park point, not the smoking equipment point. |
| 楓川弾正橋公園 | BLOCKED / 0 | Same hours and park-anchor separation. A historical removal is not current closure: the ward's FY2024 evaluation records a new partitioned smoking place and the current list includes it. |
| 数寄屋橋公園 | BLOCKED / 0 | Current smoking list: 7:00–22:30, unavailable during cleaning. CSV spans the wider named park; it cannot locate the particular smoking section exactly. Near the 1km boundary depending on center/position uncertainty. |
| 城辺橋際緑地帯 | BLOCKED / 0 | Explicit current smoking listing, but no same-named licensed park point found. Nearby bridge/park points cannot substitute. |
| 八重洲地下街 south/east/north terraces | BLOCKED / 0 | Three rooms currently listed with 6:00–23:00 hours; no reviewed lawful anchor established. One common facility anchor would give **one** canonical spot, not three. |
| 東京ミッドタウン八重洲 | BLOCKED / 0 | Ward and operator disagree on upper floor (2F versus 3F); resolve before a zone claim. School/disaster-center rows at the same address are not this smoking facility's anchor. |
| THE TOBACCO YAESU / TODA BUILDING / THE TOBACCO KYOBASHI | BLOCKED / 0 each | Smoking-specific list entries, not inferred from host names. Lawful same-facility anchors unconfirmed. |
| paspa京橋 / paspa西銀座 | BLOCKED, excluded / 0 | The current ward list explicitly records ongoing suspension; do not count their nominal hours as current availability. |

**Final unresolved gate for the three parks: `anchorCRSUnconfirmed`.**
The separate [park CSV](https://www.city.chuo.lg.jp/documents/984/koenichiran.csv)
contains park name/address/latitude/longitude, not smoking coordinates. The
[official Tokyo metadata](https://spec.api.metro.tokyo.lg.jp/spec/t131024d0000000011-5314da4ae5dcc72a4ec03f2b26261faa-0?lang=en)
identifies that exact resource and its fields (last-updated metadata 2024-05-24), but neither
it, the CSV nor the ward OD page reviewed declares the datum/CRS. Do not guess WGS84/JGD2011
from plausible decimal values or transplant the standard facility schema onto this custom CSV.
Under this task's strict ambiguous-coordinate rule, no fixture/adapter is implemented.
If primary metadata resolves this later, it can support only `areaApproximate`, scope `facility`,
park-wide anchor, “specified smoking place within park; detailed position unknown”. Never
park-wide permission to smoke, exact navigation, a measured entrance, or a manufactured pin.
No blocked park distance is certified as an additional 1km smoking point.

Rights are promising but are not a legal conclusion: the [ordinary site policy](https://www.city.chuo.lg.jp/kusei/kouhoukouchou/kouhou/aboutwebsite/thissite.html)
reserves expression; no separate information/DB-use prohibition was found in the reviewed clause.
That is an ADR-0018 factReference candidate for normalized facts only, **not CC BY for the HTML**.
The [OD page](https://www.city.chuo.lg.jp/kusei/gaiyou/toukeidate/opendata.html)
links the exact park CSV under [CC BY4.0 terms](https://www.city.chuo.lg.jp/documents/984/02termsofuse.pdf):
commercial reuse/modification and attributed derived data, with third-party-rights exclusions.
No separate exception was attached to this park resource. A future normalized DB/API/tile
may use that open-data anchor with source/title/license URL and processing notice, separately
from the page-fact attribution and checkedAt; this does not grant redistribution of unrelated
HTML, photos, logos or `map_data.csv`. The last CSV remains outside the reviewed OD scope.
No old request draft or obsolete map rights classification is treated as permission.

Hours cross-check: [currently linked smoking map PDF](https://www.city.chuo.lg.jp/documents/3263/omote.pdf),
retrieved 2026-10-17T16:50:06.074085Z, 9,529,754 bytes, SHA256
`3228948ca4a5abae58003793bf3e2967121930fb4d39ee3e71b56a2d7010fb14`.
PDFKit text inspection resolves the HTML's ambiguous noon/midnight wording; no map positions
were extracted. Historical counter-evidence:
https://www.city.chuo.lg.jp/documents/16489/r6gyouaseihyoukaall.pdf
(history context inspected, no hash claimed here). Paper/heated support remains unknown;
the general rule mentioning heated tobacco is not device-specific support evidence.

Practicality: park leads lean south/east toward Kyobashi/Hatchobori; they do not solve
Marunouchi-west or north-Yaesu coverage. Underground/upper-floor candidates add vertical
travel, access and closing-time risk. Straight-line radius does not establish a walk route.
The current list also announces Tsukijigawa Iwaibashi suspension from 2026-10-19; future
imports must retain scheduled closures rather than assume every listed row is available.

## Shinjuku: information-use restriction plus changed west-side location

Primary inventory: https://www.city.shinjuku.lg.jp/seikatsu/file11_01_00003.html
(2024-08-05); assisted rooms:
https://www.city.shinjuku.lg.jp/kenkou/eisei01_000001_00005.html (2026-03-30).
**BLOCKED / 0 additional spots for both sources.** East, southeast, west and Seibu-side
public leads exist; numerical lawful locations/current per-site review are incomplete.
The [site policy](https://www.city.shinjuku.lg.jp/kusei/about.html) limits information use
to personal/noncommercial purposes, as well as restricting reproduction. That is not a
copyright-only R1 clearance for this commercial-capable DB/API/tile use. Do not apply an
unrelated OD licence to these pages; resource permission or changed primary terms is needed.

The [official Tokyo construction FAQ](https://www.shinjuku-kojiinfo.metro.tokyo.lg.jp/faq.html)
reports west-square relocation from 2025-12-08 and links
https://www.shinjuku-kojiinfo.metro.tokyo.lg.jp/pdf/faq_23-03.pdf .
The old rotary diagram is not a current exact coordinate. This review did not georeference
that drawing. Old public-list dates alone do not prove closure or unchanged operation.

Assisted leads (all BLOCKED, not certified within1km): NISHISHINJUKU 8–24,
TOCHOMAE 8–23 (both subject to building closure); paspa御苑前 weekdays7–20;
マルタイタバコ店 non-Sunday8:30–17:30; paspa四谷 weekdays7–20. Building B2/29F
travel is not street-level availability. Tobacco types stay unknown unless specifically stated.
The official [OD catalog CSV](https://www.city.shinjuku.lg.jp/content/000428573.csv)
is UTF-8 BOM in this retrieval, has no smoking/tobacco match and does not license these lists.
The current-locations, commercial information-use and coordinate gates must all be resolved.

## Shibuya: four public station leads, lawful coordinates missing

[Official inventory](https://www.city.shibuya.tokyo.jp/kankyo/machi-seiso/kitsuen/smokingplace.html),
2026-07-23: **BLOCKED / 0 each** for モヤイ像, スクランブル交差点, 宮益坂下, 新南口.
These are smoking-specific entries. First three have year-end closure qualifiers; public
sites may close in severe weather. West/Hachiko, east/Miyamasuzaka and new-south directions
are represented qualitatively; 1km counts are not certified without reviewed points/anchors.
[Terms](https://www.city.shibuya.tokyo.jp/guide/website/list/site_policy.html) reserve
reproduction/trademarks: possible factReference R1 reading, not an open-data licence or completed
source approval. Original maps/HTML/brands are not reproduced. Source-specific rights review
and a lawful point/approximate anchor remain gates. The official OD-linked ArcGIS review found
only smoking enforcement statistics, not location data; absence of that match does not prove
no dataset exists anywhere. No Google map coordinate was adopted.

Extra restricted leads are also BLOCKED: paspa宮益坂 separates heated-only1F and paper-only2F;
クランクストリート is heated-only. Do not copy support to all public sites or count two
floors as two points at one anchor. Brand lounges may require age verification and must not
become tobacco promotion. A source-specific 2026 Halloween closure interval was not established;
do not invent one from third-party articles.

## Toshima / Ikebukuro: six normally listed candidates, one suspended

[Official list](https://www.city.toshima.lg.jp/152/machizukuri/sumai/bika/taisaku/025701.html),
2026-08-25. **BLOCKED / 0 each**: east exit24h; north exit24h; west/芸術劇場7–24;
WACCA5F10–23; FamilyMart立教通り6–20; PARCO8F11–21. No reviewed lawful numeric
smoking point or same-facility approximate anchor was established, so no 1km candidate count
is certified. Qualitatively east3/north1/west2; upper floors add vertical/access costs.
**サンカクスクエア is suspended from 2026-08-26**, not a seventh currently available place.

The [site policy](https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html)
reserves reproduction and third-party works: R1 factReference review may be possible, but is
not an approval of datasets, images or every use. Source-specific review and anchor are pending.
[Ward publicity](https://www.city.toshima.lg.jp/012/webkoho/articles/202512/feature.html)
confirms separate paper/heated areas at the west site; do not generalize to the other five.

## Taito / Asakusa: approved source, all selected rows already known

Current [official OD catalog](https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html)
still links the same 2026-08-18 release. **Existing approved source / new additional count0**.
The [CC BY4.0 display terms](https://www.city.taito.lg.jp/kusei/online/opendata/about/opd.html)
allow commercial sharing/modification, including derived DB/API/tiles under attribution and
licence conditions, without guaranteeing third-party rights. Keep ward, licence, disclaimer,
original-file link and processing notice; do not reuse photos/logos or an embedded map.
The CSV's own smoking-place latitude/longitude is the existing publisherPoint provenance,
not a host inferred coordinate. Do not silently change the accepted mapping or promote
approximate host data to that precision.

The [current ordinary list](https://www.city.taito.lg.jp/kenchiku/machibika/kosyu/webmap.html)
(updated2026-09-28) still explicitly qualifies crane-work closures at Kinryu and temporary
relocation at Kojima. These are conflict references, not a new CC BY resource. Existing
conservative attenuation/holds remain intact; a refurbishment end date is not automatic
permission to restore a withheld row. Hours unknown stay unknown; heated-only e-booth is
not paper-compatible. All ten Asakusa baseline results are in the current smoking-specific
list, but neither a desk check nor nominal hours guarantee availability on arrival.

## Next allowed step / stop conditions

No source passed **all** requested gates, so no registry, adapter, fixture, migration, client,
production dataset, D1 or Cloudflare change is made. No implementation PR is opened.
These research files were originally left locally for inspection; the preservation note above
records their later archival handoff on the requested research branch.
Research readiness is not source approval and is not a legal sufficiency finding.

To reopen a source: obtain *published* first-party CRS/coordinate documentation or another
lawfully usable anchor for Chuo; resource-scoped information-use rights and moved-site
review for Shinjuku; reviewed approximate/exact anchors and source-specific rights decisions
for Shibuya/Toshima. No publisher contact was authorized in this task. Do not request a broader
licence merely to redistribute raw HTML when normalized factReference could suffice.

Any later implementation must pin response/release hashes and checkedAt, keep attributable
anchor/existence provenance separate, use deterministic stable source identities, reject
ambiguous/missing/changed selected rows, prevent same-anchor cardinality inflation, and add
source-health scope, rights drift, hours/type/access/closure, dedup, idempotent ingest/promotion
and tile/API tests. Disappearing smoking facts, relocation, suspension, rights/anchor drift
must block/review affected claims; accidental timeout/5xx alone must not auto-delete data.
