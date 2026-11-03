# Next nationwide exact-source batch — 2026-10-10

Related: #67, #113, #137. Base `d8dca64ea26477daf44b9f251209a5fe42a6ee5c`.

**Research-only: 20 municipality leads scanned; A/B/C/D/E/F = 0/0/1/10/1/8.
New approved / implemented sources: 0/0. Canonical/published/tile delta: 0/0/0.**
No new exact smoking Point release passed all gates. These are 20 distinct expansion
leads, not 20 discovered datasets or 20 completed raw-release reviews. No absence is proven.

## Selection and prior-work exclusions

Read #113 (including the October 2 follow-up), #137, the high-value blocker report,
official reverse/east review, batch-1 onboarding, open-provider batch-2 and October 9
rights packets. Do not repeat Chuo/Kawasaki/Hiroshima rights requests, registered MLIT
Shinjuku access, closed Koto park data, host-only prefectural datasets or unchanged
OpenPOI leads. No existing blocker was reopened by this batch.

The frozen pool is **purposive**, focused on municipal GIS/open-data capability and
station-area smoking-inventory leads in four zero-published prefectures: Shizuoka,
Aichi, Shiga and Hyogo. It is not a nationwide population/volume ranking. Pool creation
uses researcher judgment; subsequent exclusion and selection are mechanical: exclude
publisher names already in the 190-target manifest, sort by municipal code, take 20.
All 20 survive. The manifest SHA and exact URL/query inputs are retained in
[JSON](nationwide-discovery/2026-10-10-exact-source-batch-next.json).
This expands beyond the existing manifest, rather than re-reviewing its blocked cities.
GIS capability is a discovery heuristic, not proof that smoking geometry exists.

Two stored query strings per municipality, plus focused follow-ups, locate candidate
URLs. Search ranking is not deterministic: frozen selection/URLs can be replayed, but
future network content cannot be guaranteed identical. Search snippets are discovery
leads only. Direct original-publisher HTML/catalog acquisition supplies the receipts;
403 hosts were stopped, without bypass or further direct requests.

BODIK/ODM provider CLI (`title:*喫煙*`, two pages, 20-reference cap per invocation)
returned six unique existing/historical Taito/Koto/Minato resources and no new source.
Exact parameters, resource identities and fetch receipts are in JSON; raw was not
re-downloaded. CKAN/BODIK are discovery-only in this decision. Reviewed OpenPOI/Overture
policy and prior results were used to exclude unchanged leads; no fresh OpenPOI request
or Overture Places export was made. Neither provider supplies canonical evidence here.

## Candidate dispositions

A = all-gate implementation candidate; B = evidence sufficient, operational blocker;
C = rights blocker on inspected route; D = no eligible smoking-site coordinates
established; E = explicit current-operation conflict; F = bounded scan with no usable
source established. Classes are exclusive primary dispositions; rights and operation
remain additional independent gates even on D/F. C does not imply a smoking layer was
found in the restricted map. D does not prove coordinates are absent elsewhere.

| Code | Publisher | Primary class | Bounded finding |
| --- | --- | --- | --- |
| 22203 | [沼津市](https://www.city.numazu.shizuoka.jp/kurashi/sumai/kankyo/rojyokitsuen/) | D | Two station plaza smoking places described; toilet CSV positions are host/amenity coordinates and excluded. |
| 22206 | [三島市](https://www.city.mishima.shizuoka.jp/page/3071.html) | E | South-exit removal notice conflicts with historical smoking-place lead; other current sites cannot inherit its position. |
| 22210 | [富士市](https://www.city.fuji.shizuoka.jp/1006050000/p007247.html) | C | Town-map route limits use to private use and excludes commercial purposes; unrelated licensed public-facility CSV does not license GIS. |
| 22211 | [磐田市](https://www.city.iwata.shizuoka.jp/shiseijouhou/1006207/1002775.html) | F | Open-data entry point exists; bounded search did not expose smoking-site Point resource. |
| 22212 | [焼津市](https://www.city.yaizu.lg.jp/life/digital-cityoffice/smart-maps.html) | F | Official map/catalog route exists; bounded inventory did not establish smoking-specific resource. |
| 22214 | [藤枝市](https://www.city.fujieda.shizuoka.jp/benri/shisetsu/map/index.html) | F | Facility map categories and Wi-Fi data are host evidence only; no smoking Point source established. |
| 23202 | [岡崎市](https://www.city.okazaki.lg.jp/shisei/opendata/1005809.html) | D | Search-index smoking inventory lead; direct publisher acquisition access-limited. Official BODIK delegation and smoking-specific facility card found; scoped reusable Point release not established. |
| 23203 | [一宮市](https://www.city.ichinomiya.aichi.jp/kankyou/kankyouseisaku/1043982/1043983/1000038/1003115.html) | D | Station east/west designated places; linked image map, no smoking Point export established. |
| 23206 | [春日井市](https://www.city.kasugai.lg.jp/) | F | Bounded official-domain keyword searches found health rules, not a smoking-site coordinate resource. |
| 23210 | [刈谷市](https://www.city.kariya.lg.jp/kurashi/pet/1003907/1003912.html) | D | Search-index smoking inventory lead; direct publisher acquisition access-limited. Official exception for manager-installed smoking places and PNG area map; generic GIS is not smoking Point evidence. |
| 23211 | [豊田市](https://www.city.toyota.aichi.jp/shisei/1073254/gyoseikeikaku/toshiseibi/1026093.html) | D | Five named dedicated facilities and image map; no numeric smoking-site export established. |
| 23212 | [安城市](https://www.city.anjo.aichi.jp/kurasu/bika/rojoukituen.html) | D | Search-index smoking inventory lead; direct publisher acquisition access-limited. Designated-place guidance; no smoking-site Point export established. Individual latest operation still requires review. |
| 25206 | [草津市](https://www.city.kusatsu.shiga.jp/kurashi/kankyo/rojokitsuenboshi/kituennzyo20210826.html) | D | Two stations have manner spaces; position PDFs only in this inspected inventory. Numeric Point/license/current per-site review unresolved. |
| 25207 | [守山市](https://www.city.moriyama.lg.jp/shisetsu/index.html) | F | Facility entry and historical/event smoking references; neither a current smoking Point release nor site operation established. |
| 28202 | [尼崎市](https://www.city.amagasaki.hyogo.jp/kurashi/kenko/kenko_joho/1011882/1039707.html) | D | Seven explicitly named municipal smoking places; addresses only in inventory, no smoking Point export established. |
| 28203 | [明石市](https://www.city.akashi.lg.jp/kankyou/kankyou_soumu_ka/kurashi/seisaku/new_sumiyoikankyo.html) | D | Five named station smoking facilities; PNG positions/photos. Licensed open-data index must not license ordinary page by proximity. |
| 28204 | [西宮市](https://www.nishi.or.jp/shisei/seisaku/kankyokatsudo/kitsuen/kitsuenkinshikuiki.html) | F | Prohibition-area notice and GIS/catalog leads; prohibition geometry and third-party OpenPOI discovery are not permitted-place evidence. |
| 28207 | [伊丹市](https://www.city.itami.lg.jp/SOSIKI/SOGOSEISAKU/JYOHO/1585621601034.html) | F | Official delegated GIS with per-layer conditions; smoking resource identity not established in bounded scan. |
| 28210 | [加古川市](https://www.city.kakogawa.lg.jp/soshikikarasagasu/kikakubu/jouhouseisakuka/ict_1/dashboard.html) | F | Official dashboard delegates open-data catalog; inspected entry points do not establish smoking-specific Points. |
| 28214 | [宝塚市](https://www.city.takarazuka.hyogo.jp/1060685/1060714/1061609/1049763/1012143.html) | D | Official designated-place exception and area maps; numeric licensed smoking Points not established. |


43 bounded direct-request receipts: 36 HTTP 200, four 403, three subsequent URLs skipped
on stopped hosts. This count excludes web-search service requests and provider CLI
requests. The 33 initial and ten supplemental receipts have their own timestamps,
exact URLs, final URLs where acquired, sizes and SHA-256. Raw bodies remain in scratch,
not git; no upstream dataset/coordinate corpus is redistributed. Keyword occurrence
counts are diagnostic HTML signals, not spot counts.

Okazaki, Kasugai, Kariya and Anjo direct publisher access is limited by 403. Indexed
smoking guidance does not make those complete primary/raw reviews. Okazaki's delegated
BODIK landing is accessible; it still does not identify a licensed smoking Point release.
Itami ArcGIS home acquisition is a JS shell: no smoking layer contents were reviewed.
F rows are bounded catalog/discovery checks, not exhaustive municipality inventories.
**Completed deep reviews of raw smoking Point releases: 0.**

## Concrete gates and follow-up value

- **Rights:** Fuji's original municipal town-map guidance limits the route to private
  use and excludes commercial use. The separate public-facility CSV's license cannot
  cover that map. Other ordinary HTML, images and facility cards have no reviewed
  resource-specific smoking-data reuse grant in this batch. General municipal CC BY
  policies cannot license neighboring ordinary pages automatically.
- **Coordinates:** Numazu's toilet CSV includes station rest-spot positions, which
  identify toilet/host amenities, not the smoking places. They are excluded. Toyota's
  five dedicated facilities, Amagasaki's seven and Akashi's five form useful explicit
  inventories, but inspected map images/address lists do not establish reusable numeric
  smoking-site Point exports. Okazaki's smoking-specific facility card is a stronger
  category lead than a host-facility row; actual licensed geometry remains unreviewed.
- **Current operation:** Mishima's acquired notice says the south-exit facility was
  removed on 2023-12-18. Its other managed sites are separate candidates; the removed
  site's position cannot carry over. Takarazuka's current HTML has morning closure
  conditions at station facilities. Those conditions prevent unconditional operation
  or `openNow` inference; they are not imported. Page accessibility/update dates never
  substitute for observation dates or release-level current-operation reconciliation.

The next valuable work is a new smoking-layer export from the official delegated GIS
or open-data catalog, particularly the explicit multi-site inventories above. Resume
these routes only when new exact-resource evidence or restored legitimate access is
available. Requests for exports/permissions are suggested follow-ups, **not sent**.
No new adapter/fixture is justified by the present evidence.

## Local baseline and validation

No contract, source registry, adapter, pipeline, migration, publication gate or
production data was changed. No address geocoding, host-coordinate substitution,
centroid, Google MyMaps/unofficial pins, OSM production data or remote D1 was used.
No community activation or #141 work was performed.

Fresh in-memory SQLite applies the real canonical D1 migrations and all six pinned
reviewed fixtures through ingest/resolve/publish. Baseline and final unchanged:
**6 sources / 515 canonical / 513 published / 81 tiles**. Quality 16/16;
cross-source candidate generation 0. Promotion v3 verification, fresh-target bootstrap,
quality 16/16 and byte-identical SQL re-export pass. The promotion target carries
513 canonical/published spots and 81 tiles: the existing v3 publication contract omits
the two withheld ingestion spots, so this is not full ingestion-state reproduction.
No v4 rollout contract was altered by this research.

| Check | Result |
| --- | --- |
| `PATH=/opt/homebrew/opt/node@24/bin:$PATH make api-validate` | pass: typecheck, 970 API tests, 101 discovery tests; no failure/skip |
| `services/api: npm run typecheck` (`tsc -p .`) | pass |
| Frozen selection replay | pass: 20 unique codes, no manifest publisher duplication; C/D/E/F = 1/10/1/8 |
| Fresh six-source pipeline / tiles | pass: 515/513/81 |
| Quality / fresh promotion-target quality | 16/16, 16/16 |
| Promotion v3 verify / bootstrap / deterministic re-export | pass |
| Cross-source checks | 0 candidates |
| `make contract` | pass |
| `git diff --check origin/main...HEAD` | pass (including post-commit check) |

Reproduce offline selection from the repository root:

```sh
python3 docs/research/nationwide-discovery/exact-source-batch-next.py
```

Live receipt replay is optional; choose a new external scratch directory. It retains
raw bodies there, uses 15-second timeout, 2 MiB limit, 1.5-second host spacing, no retries
and 403/429 stops. It never changes the frozen manual disposition or approves a source:

```sh
python3 docs/research/nationwide-discovery/exact-source-batch-next.py --scratch /private/tmp/exact-source-recheck-NEW
```

Reproduce pipeline, quality, cross-source and promotion locally without Wrangler or
network. The optional summary output is exclusively created (choose a new path):

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH node --experimental-strip-types --experimental-sqlite --no-warnings docs/research/nationwide-discovery/exact-source-batch-corpus.mts /private/tmp/exact-corpus-recheck-NEW.json
```

Independent read-only review: **P0=0 / P1=0 / P2=0**. The reviewer reran frozen selection
and the corpus/promotion reproduction; upstream raw bodies were not independently reacquired.
P0/P1/P2 describe change-review findings, not publication blocker urgency. No source is
approved; nationwide rollout and #67/#113/#137 remain open. Draft PR only; do not merge.
