# Nationwide high-value blocker resolution — 2026-10-01 JST

Issue [#137](https://github.com/Kounishiyuuki/MannerPath/issues/137), child of #67.
Codex, `data/nationwide-high-value-blocker-resolution`; starting main
`5c7dc0c84ba9b7860e047a1ba746acb649a4e837` (#135).

## Outcome

**19 groups processed: 17 bounded reviews completed, 2 pending. One access blocker
resolved; approved / implemented / new published spots = 0 / 0 / 0.** All 19 remain
publication-blocked. No new prefecture or major-city publication coverage.

The initial queue is mechanically selected by `discovery/high-value.mjs` from previous
explicit named-smoking inventories, plus the four user-mandated priorities. Priority
counts: **P0=1, P1=0, P2=1, P3=17**. This is a bounded queue, not an exhaustive claim
about every high-value candidate in the 190-target manifest. P3 includes named
inventories needing exact geometry and scoped rights; these are less close to approval
than Chuo. General facility-only evidence and already implemented duplicate sources
are excluded. The batch processes the entire selected 19-group queue and exceeds the
requested minimum 15 groups **processed**. It does **not** claim 15 blockers unlocked.

Machine-readable [queue](nationwide-discovery/2026-10-01-high-value-blockers.json)
separates `processingStatus`, pending/completed review, `blockerResolved`, and approval.
The [individual reviews](nationwide-discovery/2026-10-01-high-value-reviews.json)
retain 87 retrieval receipts and the exact unknown approval fields. Historical raw
exclusions remain historical; a hash is not presented as a fresh byte inspection.
No protected smoking-coordinate raw is promoted into a fixture or canonical database.

## Priority results

### Chuo — 79 candidates, rights and operation blockers retained

Followed the [official current inventory](https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html)
through its map and linked script to the exact publisher CSV.
SHA `fa01ff6cd368dc32da68eca0148ca43ee31e8c823e5e8d0a692afc35d5edcbfe`,
177,844 bytes, 771 raw rows; unchanged from #135.

**Correction to #135:** 79 smoking-title rows comprise **76 exact `13007003000`
指定喫煙場所 rows and 3 parent-category `13007000000` rows**, not 79 exact-category
rows. Parent-category page IDs: `17528`, `17549`, `18638`. All 79 have supplied
valid latitude/longitude pairs. They are publisher smoking-labeled map markers;
CRS, positional accuracy and surveyed entrance semantics remain unstated.

The [open-data page](https://www.city.chuo.lg.jp/kusei/gaiyou/toukeidate/opendata.html),
its exact three-page [terms](https://www.city.chuo.lg.jp/documents/984/02termsofuse.pdf),
and 35-row catalog were re-read. Terms are scoped to the listed open-data page.
The map CSV and smoking resource are absent there. The ordinary
[website policy](https://www.city.chuo.lg.jp/kusei/kouhoukouchou/kouhou/aboutwebsite/thissite.html)
restricts unauthorized redistribution/adaptation. The existence of neighboring
CC BY datasets does not license these location values or a derived database.
Attribution/share-alike for this exact raw remain unapproved.

The current list has 79 site headings. A conservative text correspondence pass
strips the raw designated-place prefix and heading numbering, applies NFKC and
whitespace removal, then uses exact equality. **72 exact matches; 7 nonexact names**.
**Nine exact matches contain restriction/suspension keywords**, including seven
whole-site indefinite-suspension notices, one dated inspection with possible extension,
and one paper-cigarette-only suspension. Those nine are not all classified closed.
The nonexact group includes a parking-site relocation; old coordinates cannot follow
it automatically. Per-row IDs and review-triage flags are in the review JSON, with no
coordinate values copied into an importer. The remaining 63 matches without those
keywords are **not** an approval or a verified-current subset. Rights fail for every row.
No blind 79-row adoption and no cherry-picked production selection.

### MLIT / GSI Shinjuku R2 — official acquisition still pending

Both [standard](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2/resource/f78d039e-7bb6-4b6a-9f5f-2b5a39e309d6)
and [integrated](https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2/resource/33e78a35-c16a-4746-b451-47c6122ed51b)
resource pages return 200 and explicitly require registered login for ZIP download.
No anonymous archive URL is exposed. This session has no callable browser execution
surface; no credentials, browser session stores, account creation or auth workaround
were used. Actual inventory/category values/F019/F024 counts are **unknown**, not zero.

Exact public dataset terms (two pages, SHA
`37105bbb2fa867eab50230f87c8a0e37a2c0cd74ef4dea5da15de3e8b165a4e3`)
allow reuse under GST2.0-compatible rules/CC BY 4.0, with attribution/change notices
and third-party/excluded-content exceptions. Exact archive/selected-feature notices
remain unread. Attached 2018 specification SHA
`0741cfd6de43df0e9a313f3de7d72af93faccc7461eaac0bca190169c3cecc80`,
43 pages: p.39 F019 police box, F024 smoking representative Point, F029 postbox;
p.9 JGD2011 latitude/longitude. These are **schema** findings, not actual Shinjuku
geometry or archive PRJ inspection. No mirror/recovered payload approves a source.
Current individual smoking-site operation remains unknown. Both releases stay pending.

### Hokkaido — exact raw timeout resolved; no smoking source

The [official exact facility CSV](https://www.harp.lg.jp/opendata/dataset/227/url_resource/41/Hokkaido_OD_GeoDataBase2018.csv)
was fetched once with 30-second timeout and no retry, then cached:
4,860,326 bytes, SHA `f341183ec01e2317ee14b707921a1e13a698fc80e9234e77233c166c713c7e05`.
Strict CP932: 35,578 rows, ten fields; **zero 喫煙 / 灰皿 / smoking keyword rows**.
The publisher schema explicitly describes host-facility/building positions assembled
from older facility data and warns about closure and missing new facilities.
The access blocker is solved; this raw is ineligible smoking evidence. No host join.
A separate one-shot targeted HARP keyword search still timed out. The wider
jurisdiction is not declared free of smoking datasets.

### Yamanashi — host stop retained; legitimate alternate checked

One normal GET to the prefectural `/chosya/` lead returned 403; the host stopped.
The separately published [Yamanashi data-platform catalog](https://catalog.dataplatform-yamanashi.jp/ja/dataset?q=%E5%96%AB%E7%85%99)
and its documented public CKAN query returned 200 / success / count 0 for 喫煙.
No eligible raw coordinate resource was found on that bounded alternate route.
Rooftop/Kofu leads remain unverified and pending; no attempt to defeat the 403.

## Other selected groups

| Group | Actual follow-up and remaining gate |
| --- | --- |
| 広島市 | Six-booth current list: addresses/photos/diagram, no numeric smoking geometry. Exact reusable coordinate resource unknown |
| 名古屋市 | Three-site list, original copyright policy, official delegation to current BODIK portal; no smoking Point in bounded catalog follow-up |
| 静岡市 | Exact current survey CSV: 12 physical records / 3 named site sections, counts through R8.1.29; no coordinate columns. Google links excluded |
| 足立区 | Current station inventory, 17 named KML categories, GIS and newly linked open-data entrance; no smoking export; ordinary reuse restricted |
| 荒川区 | Nine-site list, air-conditioning qualifier, exact copyright page; geographic links are Google; raw geometry/reuse blocked |
| 文京区 | Designated/assisted tables, facility-map index and site policy; previous script audit reused, no exposed publisher smoking export |
| 千代田区 | Free/assisted inventories, full catalog, exact map-image reuse exclusion; mobile/suspended locations remain uncertain |
| 板橋区 | Two-site smoking list and actual GIS category index; previous 23 raw host rows retained as exclusions, not redownloaded |
| 目黒区 | Followed publisher URL relocation to new 19-place list; October 1 opening qualifier retained; Google MyMaps excluded; ordinary reuse restricted |
| 中野区 | Smoking list, container opening announcement, original restrictive site policy; image/PDF locations lack eligible raw geometry |
| 大田区 | 11-site table, original policy and complete current scoped open-data table; no smoking resource labels, no permission transfer |
| 渋谷区 | Current smoking inventory, original policy and all 172 public ArcGIS organization items; smoking match is enforcement statistics. Prior full group review retained separately |
| 品川区 | Smoking list, official GIS delegation/current download categories; previous 36+351 raw host-row exclusions retained, no smoking layer |
| 杉並区 | New GIS 403, Tokyo catalog 403, old export 404; hosts stopped. No acquired smoking Point or exact rights |
| 墨田区 | Current smoking/closure pages, map directory and newly followed scoped full open-data list; no smoking export; dated trial does not prove current operation |

Shared official BODIK search returned five packages; matching Nagoya/Hiroshima package
count zero. This is a targeted catalog check, not a replacement nationwide discovery
scan. No unrelated XLS/XLSX ingestion or portal-coverage changes overlap Claude's v2 work.

Manifest corrections: verified Yamaguchi official `/ckan/` (200, current CKAN dataset
inventory) is the replacement for erroneous `/www/`. Concurrent #138 supplies the documented
CKAN API connector under `/ckan/`; rebase retains that more specific connector
in manifest and generator. Meguro gains exact
new official routes while preserving the old URL's historical research. Manifest
`highValueReview` is orthogonal to existing scan/deep-review state; no source approval.

## Validation and corpus

No source was added, so new-source fixture/adapter/local Wrangler D1 onboarding is
inapplicable. Required no-addition checks and an independent fresh all-source
SQLite/D1-compatible verification were run. It is not a remote/production D1 run.

| Check | Result |
| --- | --- |
| Queue regression tests | 3/3 pass; host-only exclusion, no implicit approval, unknown counts, processed/pending/resolved split, Chuo 76+3 and corrected catalog URL |
| `make contract` | pass |
| `make api-validate` | pass after rebase: 581 API +63 discovery tests, no fail/skip |
| `services/api: npx tsc -p .` | pass |
| All real migrations through 0021; six pinned source pipelines; combined publish | 515 canonical / 513 published / 81 tiles |
| Quality | 14/14 pass |
| Promotion v3, fresh migrated bootstrap and deterministic re-export | pass; byte-identical SQL, reviewed content SHA `a3ed3f2fb8f37560578e10519fbfb4fe5f57a0720ebc9a2a18e960d0ee9ba73e` |
| Cross-source generation | 0 candidates; no canonical mutation |
| Diff checks | staged and origin/main diff checks pass after rebase |

A temporary verification script initially passed the wrong property as the expected
promotion hash and received `promotion verification refused: the expected contentSha256
is not 64 lowercase hex digits`. Corrected to `bundle.manifest.contentSha256`, reran
successfully; no production-code fix or bypass. Source/community architecture is
unchanged: no `granted` terms, community approval, #124 closure or remote D1.

Network uses #132 FetchCache: concurrency one per host, 1-second delay, 30-second
timeout, retries zero, cache/resume and ETag/Last-Modified metadata. 403 hosts persist
stops within this run. No proxy, user-agent trick, hidden endpoint guessing or mirror.
Expiring signed PDF redirect URLs are deliberately absent from committed receipts.

## Next highest-value work

1. Chuo: obtain publisher permission **specifically** covering map CSV location values,
   derivation and redistribution, then resolve all flagged/nonexact current-operation
   rows. That permission cannot be inferred from the neighboring catalog.
2. Shinjuku R2: obtain standard/integrated official registered ZIPs with acquisition
   chain and archive notices; enumerate actual per-floor Point/category inventory and
   match any eligible feature to current official operation.
3. Suginami: legitimate restored GIS access or an officially released exact smoking
   Point raw with resource-scoped terms; keep host stops until access is restored.
4. Yamanashi: restored prefectural access or newly published official machine-readable
   coordinates; current rooftop/relocated-place semantics must be checked before reuse.

Integration: rebased onto Claude Discovery v2 PR #138 main
`69663e863ada54d2f95ba8f708a38e591bde5865`. Both manifest/generator endpoint
conflicts were resolved by retaining Claude's documented Yamaguchi CKAN API route,
all other v2 formats/connectors/dependency/endpoints and our19 review annotations.
The v2 review JSON has no newly eligible smoking Point candidate: Sapporo's smoking
asset-register row has no coordinates/current operation; remaining hits are forms,
surveys/statistics or the existing Osaka source. No overlapping raw/source edit.

Final rebased validation: `npm ci` succeeds; `make contract`, `make api-validate`
(581 API +63 discovery), separate `npx tsc -p .`, fresh six-source combined corpus,
quality14/14, v3 bootstrap/deterministic re-export and cross-source0 all pass.
`npm audit` reports three existing dev-tool dependency findings (undici high,
miniflare/wrangler moderate), `fixAvailable=false`; no dependency change is made
in this six-file branch. This is a known residual dependency issue, not a failed
publication-quality check.
