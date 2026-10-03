# High-value nationwide source rights review — 2026-10-04 JST

Independent Codex research lane for [#67](https://github.com/Kounishiyuuki/MannerPath/issues/67), [#113](https://github.com/Kounishiyuuki/MannerPath/issues/113), [#137](https://github.com/Kounishiyuuki/MannerPath/issues/137), [#141](https://github.com/Kounishiyuuki/MannerPath/issues/141).
Base main: `f53477898a0971d0bbc6877dd559e5296a50d845`.
Branch: `research/high-value-source-rights`.

**ONBOARDING READY: 0 sources. Newly resolved rights blockers: 0.** Nine bounded candidate reviews are recorded in the [machine-readable evidence](nationwide-discovery/2026-10-04-high-value-source-rights.json). This negative result does not establish that an eligible source does not exist. No publisher was contacted; no explicit permission was obtained. These are engineering reuse-review findings, not legal advice about statutory exceptions.

## Readiness and classification

A = ready with exact publisher point; B = ready with `areaApproximate`; C = **rights only** unresolved; D = location blocker; E = current-operation blocker; F = insufficient evidence; G = exact license scope unknown; H = access blocker. Codes can coexist. Rights restrictions are recorded separately: a source with both rights and location blockers is D, not C. No whole source qualifies as A, B or C in this review.

| Priority/source | Classification | Location representation | Onboarding readiness / exact remaining gate |
| --- | --- | --- | --- |
| P0 中央区 | E; rights blocked | 79 numeric publisher-marker candidates (76 exact category +3 parent category) | BLOCKED: exact smoking CSV/HTML reuse permission; suspension, relocation and point semantics review |
| P1 広島市 | D; rights blocked | Six smoking booths described by park/address; no accepted numeric anchor | BLOCKED: smoking-publication permission and reusable location representation |
| P1 川崎市 | D; rights blocked | 12 designated places by address/relative description | BLOCKED: smoking-publication permission including transformation; reusable location representation |
| P1 新宿区 | D/E; rights blocked | Seven public places plus separate five-room subsidized list; addresses/diagrams | BLOCKED: smoking-publication permission and location; older public-list currency must be reviewed per row |
| P1 文京区 | D; rights blocked | Two designated sites plus six indoor rooms; addresses/floors | BLOCKED: smoking-publication permission and location; row-level opening/closure qualifications retained |
| P1 板橋区 | D; rights blocked | Two rooms; street-block addresses/photos | BLOCKED: smoking-publication permission and location; 2024 page is not a fresh field observation |
| P2 MLIT Shinjuku R2 archive | H/E/G | Actual archive smoking features/Point counts unknown | BLOCKED: legitimate archive acquisition, selected-feature notices and current operation |
| P2 杉並区 GIS | H/G/D | Official smoking list exists; GIS Point/anchor not acquired | BLOCKED: GIS access, layer-specific reuse scope and reviewed location |
| P2 山梨県庁 | H/G/D/E | Official cached floor/roof description; no reusable numeric anchor | BLOCKED / REVIEW REQUIRED: fresh access/current operation, exact PDF reuse scope and location |

ADR-0017 is Accepted, but implemented anchor policy v1 requires existence and the representative point to come from **the same publication/release**, with reviewed mapping and provenance. A separately licensed park/facility CSV cannot anchor an ordinary smoking HTML list under current v1. A text address/floor is not a numerical representative point. Google/Apple/OSM coordinates, screenshot pins and inferred centroids are not adopted.

ADR-0011 remains Proposed. P1's five address sources are **conditional future derived candidates only after their smoking-resource rights are resolved and ADR-0011 is approved**, followed by individual address/precision/current-operation review. This review resolves none of their rights. The earlier ≥27-spots impact remains a historical bound, not a fresh eligible or publishable count. Policy approval alone still does not unlock these sources. No geocoding, activation or derived publication was performed.

## P0: 中央区

Fresh direct GETs at 2026-10-03T16:30:31–38Z (2026-10-04 JST) followed the [official map](https://www.city.chuo.lg.jp/shisetsu/map/sonota/index.html), its [script](https://www.city.chuo.lg.jp/shared/system/js/maps/prev_csv_gmap2.js) and [exact CSV](https://www.city.chuo.lg.jp/shisetsu/chizu/csv/map_data.csv). The 177,844-byte CSV SHA256 is unchanged: `fa01ff6cd368dc32da68eca0148ca43ee31e8c823e5e8d0a692afc35d5edcbfe`. It has 771 data rows; 79 smoking-title rows comprise 76 `13007003000` and three `13007000000` rows. All 79 supplied latitude/longitude pairs pass a numeric Japan-range check. This does not establish CRS, surveyed smoking-point/entrance semantics or continued operation.

The [current smoking inventory](https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html), dated 2026-10-02, has 79 site headings. Fresh inspection retains seven whole-site indefinite suspensions, a dated inspection with possible extension, a paper-cigarette-only restriction, and the relocated/reopened GS parking site. Do not treat every restriction as complete closure or carry the old parking coordinate to its replacement. Earlier 72 exact/7 nonexact name matches remain historical research; no fresh approved subset is asserted.

The [open-data page](https://www.city.chuo.lg.jp/kusei/gaiyou/toukeidate/opendata.html), [35-row catalog](https://www.city.chuo.lg.jp/documents/984/open_data_list.csv) and [terms PDF](https://www.city.chuo.lg.jp/documents/984/02termsofuse.pdf) establish CC BY4.0 only for listed open-data publications. Fresh catalog inspection finds no smoking labels or `map_data.csv`. The PDF opening defines its open-data-page scope; section3 does not extend its precedence to the ordinary site. Its app/database modification credit template is useful **only if the resource is actually covered**. The [ordinary website terms](https://www.city.chuo.lg.jp/kusei/kouhoukouchou/kouhou/aboutwebsite/thissite.html) restrict unauthorized republication/adaptation. Modification, commercial DB retention and API/tile redistribution permission for the smoking CSV and HTML remain unestablished; attribution alone is not permission.

Next permission request should identify both exact resources and ask the health-policy publisher and open-data owner for scope, normalization/modification, retention, commercial reuse, API/tile/DB redistribution, third-party exclusions and attribution. No request was sent. Once permission exists, reconcile each active/relocated marker. The whole 79-row pool is not a rights-only onboarding set.

## P1: official smoking evidence, unresolved reuse and location

Each linked ordinary publication gives smoking-specific evidence; host existence is not used to infer permission to smoke. The JSON records separate modification, redistribution, commercial-use, attribution, storage and license-scope findings for every source.

### 広島市

The [official six-booth inventory](https://www.city.hiroshima.lg.jp/living/gomi-kankyo/1021281/1037470/1024206.html), dated 2025-02-16, supplies addresses, images and use instructions, with a possible future closure warning. It is a current published list, not an observation on fetch day. The [ordinary site terms](https://www.city.hiroshima.lg.jp/about/1010662.html) restrict unauthorized use, copying, republication, sale and modification, subject to special terms. The [municipal open-data policy](https://www.city.hiroshima.lg.jp/shisei/gyosei/1021856/1006054/1027540/1018959.html) does not establish licensing for the ordinary smoking page. A linked [park/green-space resource](https://hiroshima-opendata.dataeye.jp/resources/10099) returned403 in the bounded review; no matching coordinate or exact license is approved. Even a restored separate park dataset would face v1's same-publication condition. Permission for the smoking inventory remains necessary.

### 川崎市

The [official 12-place list](https://www.city.kawasaki.jp/kurashi/category/262-2-4-0-0-0-0-0-0-0.html), dated 2025-08-07, supplies designated smoking places and address/relative descriptions. The [ordinary copyright policy](https://www.city.kawasaki.jp/main/site_policy/0000000027.html) requires advance contact for copying/republication and conditions such use on leaving content unmodified. That route is not sufficient permission for transformed database/tile output. The [open-data terms](https://www.city.kawasaki.jp/170/cmsfiles/contents/0000057/57493/kawasakiod_rules.pdf) scope CC BY2.1 JP to listed datasets; catalog membership for the smoking publication was not established. Scoped OD attribution would require title, city, license link and modification credit, but cannot be transferred to this page.

Two previously404 catalog category pages returned200 this time; public-facility/environment lists did not establish smoking-resource inclusion. This is an access update, not a rights resolution; historical negative receipts are retained.

### 新宿区

The [seven public-place list](https://www.city.shinjuku.lg.jp/seikatsu/file11_01_00003.html), dated 2024-08-05, warns that latest conditions may differ. The separate [five subsidized-room list](https://www.city.shinjuku.lg.jp/kenkou/eisei01_000001_00005.html), dated 2026-03-30, explicitly identifies currently operating rooms and gives hours/floors. These are not the registered MLIT archive and must not be merged as its evidence.

The [ordinary site terms](https://www.city.shinjuku.lg.jp/kusei/about.html) limit individual downloads/reproduction to noncommercial use and require prior permission for modification/distribution/publication. The [open-data catalog](https://www.city.shinjuku.lg.jp/opendata/opendata_top.html) scopes CC BY2.1 JP to listed data. The freshly fetched [catalog CSV](https://www.city.shinjuku.lg.jp/content/000428573.csv), 51,357 bytes CP932, has no 喫煙/たばこ/タバコ matches. No exact smoking license or numerical point/anchor is established.

### 文京区

The [designated inventory](https://www.city.bunkyo.lg.jp/b003/p006762.html) includes two designated sites and six indoor rooms; the [indoor publication](https://www.city.bunkyo.lg.jp/b037/p005122.html), updated 2026-06-22, provides smoking-specific descriptions, dates, hours and closure qualifications. Google links are excluded as canonical coordinates. The [ordinary policy](https://www.city.bunkyo.lg.jp/b003/p006007/index.html), updated 2026-04-16, prohibits unauthorized secondary use and directs inquiries to each page's owner. The [test OD portal](https://www.city.bunkyo.lg.jp/b004/p006749.html) has no smoking entries in inspected HTML; its linked [OD PDF](https://www.city.bunkyo.lg.jp/documents/9212/20201214171329.pdf) was not readable through the research web fetch. The portal's CC BY4 label does not establish ordinary-page scope. Rights remain unresolved; no PDF interpretation is asserted.

### 板橋区

The [two-room list](https://www.city.itabashi.tokyo.jp/bousai/kougai/bika/kitsuen/1019824.html), dated 2024-03-28, supplies operating dates, operators, daily hours and block addresses for Takashimadaira and Narimasu. Direct HTML was accessible despite web-tool errors. An accessible older list is not fresh field verification. The [ordinary policy](https://www.city.itabashi.tokyo.jp/kusei/kouhou/about/index.html) restricts unauthorized reproduction/repurposing. The [GIS open-data page](https://www.city.itabashi.tokyo.jp/kusei/joho/sisetsu/1031246.html), updated 2026-02-04, grants CC BY4 only to specified section datasets; no smoking category is listed. Host points cannot supply smoking existence or automatically satisfy v1.

## P2: access and exact scope remain unresolved

- **MLIT Shinjuku R2:** the [official dataset](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2) returned403 through the web tool; the host was stopped. [Standard resource](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2/resource/f78d039e-7bb6-4b6a-9f5f-2b5a39e309d6) and [integrated resource](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2/resource/33e78a35-c16a-4746-b451-47c6122ed51b) remain legitimate registered-acquisition leads. Prior inspected [dataset terms](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2/resource/e3b28fde-5546-4c9d-956b-69363d707835) permit GST2.0/CC BY4-compatible reuse with attribution/change notices and exclusions; this is **historical**, not fresh archive-notice review. F024 Point is a schema definition; actual smoking features, geometry and current operation remain unknown. No login, account creation or mirror was used.
- **杉並区:** [official smoking list](https://www.city.suginami.tokyo.jp/s102/688.html) dated 2025-04-01 presents six station-front and two indoor places. [GIS](https://suginami.geocloud.jp/) returned403; stopped. [Ordinary terms](https://www.city.suginami.tokyo.jp/about/17.html) restrict unauthorized copying/modification. [OD page](https://www.city.suginami.tokyo.jp/s005/8444.html) and [terms](https://www.city.suginami.tokyo.jp/documents/8444/opdata-riyoukiyaku.pdf) do not establish rights to an inaccessible smoking layer or ordinary list. No numerical anchor was acquired.
- **山梨県:** a normal direct GET to [prefectural office page](https://www.pref.yamanashi.jp/chosya/) returned403 at 2026-10-03T16:30:53Z and the direct host was stopped. The web tool surfaced older official crawls, which are separately labeled: page dated2025-12-03; [smoking PDF](https://www.pref.yamanashi.jp/documents/99075/kituenjyo.pdf) dated R6.2.19. They describe relocation from the old annex outdoor site to north-annex floor6/roof access. This is an official textual lead, not restored access or fresh current-operation confirmation. [Ordinary terms](https://www.pref.yamanashi.jp/info/howto_site.html) restrict unauthorized reuse; [OD terms](https://www.pref.yamanashi.jp/opendata/kiyaku.html) cover platform/catalog data only. No smoking-PDF exception or reusable numerical representative point is established. The earlier bounded catalog zero result is retained; no new exhaustive catalog absence claim is made.

## Next implementation order and handoff

There is **no immediate source-onboarding implementation** supported by these findings. Conditional priority after permission/location review:

1. **中央区:** highest impact and publisher numeric candidates already available; obtain exact scoped rights, then review current/relocated rows and point semantics.
2. **川崎市:** 12-place inventory and new Kanagawa coverage potential; seek a licensed smoking-specific coordinate release (preferred) or explicit address reuse permission, then ADR-0011 review. Ordinary unmodified-content permission is insufficient.
3. **広島市:** six-booth inventory and new Hiroshima coverage potential; seek a licensed smoking-specific point/area-anchor publication, or address reuse permission before ADR-0011 review. Separate park coordinates alone do not satisfy current v1.

Explicit permission/OD designation is still needed for 中央区、広島市、川崎市、新宿区、文京区、板橋区 and the ordinary 杉並区/山梨県 smoking publications. MLIT's catalog-level reusable terms do not replace legitimate archive acquisition and selected-feature/exclusion review. Any actual contact needs a separate authorized task.

## Method, validation and scope

Primary official pages/resources/terms were inspected; search engines served discovery only. Checked times are UTC in JSON (2026-10-04 JST). Web primary rendering may expose cached crawls; direct status and historical evidence are distinguished. Normal GETs only; no retry/bypass after403, no private endpoints, credentials or third-party coordinates. Chuo direct retrievals were serialized with a one-second delay; receipt hashes and status are retained without copying protected coordinates into repository fixtures. Other bounded findings record URLs and inspection time; no hash is claimed without byte inspection.

Only these two new research artifacts are changed. Existing research and negative results remain intact. No registry/source approval, canonical spot, migration, production dataset, remote D1, deployment, #124 change, geocoder or generator change. Validation: `git diff --check`; JSON parse and required-field/count consistency check. No API/full-suite tests are required for this documentation-only lane.

Independent read-only review checked counts, classification and policy consistency. Its current-operation finding was addressed: Shinjuku public seven-site currency is explicitly E, separate from the five-room current-operation wording. JSON required-field/count consistency and staged `git diff --cached --check` passed.
