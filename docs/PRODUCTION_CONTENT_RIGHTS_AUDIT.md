# Production Content Rights audit — MannerPath v1

Audited 2026-10-05 against main `0acbc7188fb314a1fa8698a748124dc20d4bb895`.
This is repository/public-license release evidence, **not legal advice, maintainer legal signoff,
or authorization to submit in App Store Connect (ASC)**. No production mutation, source addition,
community activation, OSM adoption, code change or artifact regeneration was performed.

## 1. Decision and remaining gate

**CONFIRMED: v1 contains third-party content.** The proposed ASC choice is **Yes, contains
third-party content**, with the necessary-rights declaration only after the gates below are resolved.
[Apple's Content Rights definition](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
requires rights/permission in every selected App Store country/region. Do not select “no third-party content”.

**CONFIRMED: the live municipal corpus is the reviewed 513 spots / six approved sources / community 0.**
Source-specific reuse permissions, release fingerprints and API attribution agree with the reviewed registry.
Five sources carry explicit extraction/normalization/change notices. **Overall rights-condition completion
is not CONFIRMED: Taito's recipient-facing modification indication is unresolved (§5).**
This is a conservative submission evidence blocker, not an assertion that the publisher's license is absent
or that a legal violation has been established. It cannot be closed by this audit's maintainer signoff alone.

After that issue is resolved, the operator still must approve the rights declaration for actual storefronts,
the final signed iPhone/Watch attribution surfaces, MapKit presentation, shipped assets/screenshots and
downstream terms/technical restrictions. None of those approvals is recorded as complete here.

## 2. Production identity and corpus checks

Origin: `https://mannerpath-api-production.happywestyuki.workers.dev`.
Read-only target: canonical `DB`, production D1 `ffbaea1e-b57e-4064-abeb-a0c53f459662`.
Earlier successful-launch evidence is `/tmp/mannerpath-production-rc/PRODUCTION_LAUNCH_RESULT.txt`
(its later resume SUCCESS section supersedes the earlier STOPPED section). Today's SELECTs/GETs,
not that historical log alone, establish the corpus below. No REPORTS_DB data was imported or changed.

| Evidence | Observed result |
| --- | --- |
| `COUNT(*) FROM tile_snapshot_spots` | 513 |
| Approved `sources` | 6; all municipal, exactly the IDs in §3 |
| Published spots missing existence provenance | 0 |
| Published field provenance from OSM/userReport, blocked or missing-license/attribution sources | 0 |
| Published field provenance outside exact `promotion_v4_expected_sources` source/release/SHA | 0 |
| Published entity links to nonmunicipal/nonapproved sources | 0 |
| Source display name/license/attribution differing from promotion expected metadata | 0 |
| `promotion_v4_manifests` and `promotion_v4_completions` | One each, same reviewed bundle digest |
| `/v1/readiness` | HTTP 200, `completed=true`, state `completed` |
| `/v1/config` | `reports.available=false`, `photoEvidenceEnabled=false`, draft report terms only |

Existence lineage: `tile_snapshot_spots → spot_field_provenance(field='existence') → source_records →
source_releases → sources`. Grouped distinct published IDs sum to 513. The broader field-provenance
query checks **all** published fields, not only existence. Entity links were checked separately.
All D1 query responses reported `rows_written=0`, `changes=0`, `changed_db=false`.

Exact release artifacts remain unchanged:

- Bundle: `/tmp/mannerpath-production-rc/bundle-v4`, `wholeBundleSha256=430c3af7520b1dc8f9513c765d628dd7443097c3c6b21cb1a958d30cc5357a69`.
- Plan: `/tmp/mannerpath-production-rc/import-plan`, `wholePlanSha256=b084a7ae8186febb8535fdcc274ab75d4a44ed2cce601d555f996d5edc3fc272`.
- Node 24 `promotion:v4:verify` and `promotion:v4:verify-import-plan` both returned `status=verified` with these exact digests.
- Each live source's release SHA/license/attribution was compared with the bundle manifest;
  live license/attribution/status also matched `reviewedSource` in the repository (6/6).

Temporary raw audit evidence (not tracked; no credentials): `/tmp/mannerpath-content-rights-production.json`,
`/tmp/mannerpath-content-rights-checks.json`, `/tmp/mannerpath-content-rights-lineage.json`,
`/tmp/mannerpath-content-rights-api.json`. The durable summary, exact IDs/hashes/notices and query method
are recorded here; those temporary files are not a future submission prerequisite.

## 3. Six-source permission and release matrix

[SOURCES.md](SOURCES.md) and each linked fixture `PROVENANCE.md` retain the original approval scope.
This review does not expand any scope, approve new releases or infer licenses for ordinary municipal HTML.

| Publisher / exact source ID | Live published spots / release ID / content SHA-256 | Dataset / reuse basis |
| --- | --- | --- |
| 台東区 / `taito-public-smoking-areas` | 32 / 1 / `5123ee41251bf22ebacfbcaee5d781c883ad8823f8861c4824a3deff012c6c74` | [Facilities dataset](https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html), 20260818 CSV; [ward display terms](https://www.city.taito.lg.jp/kusei/online/opendata/about/opd.html); [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.ja) |
| 大阪市（計画調整局 catalog / 環境局 smoking listing） / `osaka-designated-smoking-areas` | 344 / 2 / `f58b62791396bc46ceca436a7c4ad598520a5c9dd4162b37723ef519399e69ce` | [Mapnavi dataset, item 14](https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html), `opendata_1012.csv`; publisher's image link selects [CC BY 2.1 JP](https://creativecommons.org/licenses/by/2.1/jp/legalcode), **not** 4.0 |
| 江東区（環境保全課; Tokyo catalog） / `koto-station-smoking-areas` | 3 / 3 / `e36e81d58348db6607a374f18a77ae54801eb55b810fba2849cf49c14318126d` | [Exact package API](https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t131083d0000000061), station CSV only; [ward catalog delegation](https://www.city.koto.lg.jp/012107/koto_opendata.html), [Tokyo terms](https://portal.data.metro.tokyo.lg.jp/terms/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| 京都市（文化市民局くらし安全推進課 rows） / `kyoto-public-smoking-places` | 17 / 6 / `bd37bbcbc413751f8ae5e3e5c88b397a452f953aad1b330c326cbaba137715cc` | [Dataset](https://data.city.kyoto.lg.jp/dataset/00003/), [exact 21432 resource](https://data.city.kyoto.lg.jp/resource/?id=21432), edition 2026-09-03; [portal terms v3](https://data.city.kyoto.lg.jp/contents.php?category=0), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.ja) |
| 武蔵野市 / `musashino-public-smoking-areas` | 3 / 4 / `fc6986b986ec315691299a12583f14a8fd942e34075fd1e9e44837dc72c57a7c` | [Exact item 4(2)](https://www.city.musashino.lg.jp/shiseijoho/tokeishiryo/chiikiseikatsu_kankyoshihyo/1040384/1040390.html), `toilet.zip` KML member; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) applies to that item; SHA identifies extracted KML, not outer ZIP |
| 港区（catalog author 企画経営部区長室） / `minato-designated-smoking-areas` | 114 / 5 / `d11ad6a5c2c72bba114d58bc7cce9f84f54338c75ee37cdd275b7680c6314220` | [Facilities dataset](https://opendata.city.minato.tokyo.jp/dataset/minatokushisetsujoho_fukugo), exact hosted CSV; [catalog terms](https://opendata.city.minato.tokyo.jp/about) permit [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); [exceptions annex](https://opendata.city.minato.tokyo.jp/pages/exhibit) does not exclude this resource |

All six permit commercial reuse, modification and redistribution under their respective licenses;
none is NC, ND or share-alike. CC BY 4.0 §2/§3/§4 covers sharing/adaptation/database extraction,
credit/license/source/notices and indication of changes, without incompatible downstream restrictions.
CC BY 2.1 JP §3/§4/§5 covers reproduction, derivation, distribution/public transmission, credit/title/URI
and retained notices; preserve recipients' licensed rights, not a claim to relicense the entire combined DB.
Neither license grants third-party trademark/personality rights or government endorsement.

| Source | Source-specific conditions / additional app or database considerations | Release inclusion basis / unresolved point |
| --- | --- | --- |
| Taito | Preserve four prescribed elements, original CSV URL, no-warranty sentence and license link. Ward asks new products/services to contact its information policy department; record maintainer handling, not prior permission inferred. General CC change condition is separate from four-element example | Pinned licensed CSV; 34 raw rows, 32 public after conservative holds. Four elements match; change indication unresolved (§5) |
| Osaka | Author, supplied title, dataset/raw/license URLs, disclaimer, derived-use credit. Do not replace resource-specific 2.1 JP with generic site 4.0. No conflicting downstream restrictions/technical protection | Only 344 designated-smoking rows; information-provided venues/recycling not public; explicit extraction/normalization credit |
| Koto | Tokyo modified-database credit example, title, Tokyo/ward credit, license/raw URL, changes/disclaimer. Terms exclude unrelated site imagery/logos and prohibit public-order/security misuse; no special smoking-app license found | Only three station points; park resource blocked despite same package license; modified-database notice included |
| Kyoto | Per-resource license; retain copyright holder and edition, credit 京都市オープンデータ, changes/disclaimer. Unlicensed site design, logos, photos not covered. Portal showcase contact is for optional listing, not an app-use permission prerequisite | Category 138 scoped to 17 reviewed points; two conflicting 西大路 rows withheld; ordinary current-operation HTML not copied |
| Musashino | Item-level license/source link, changes and nonendorsement. Other layers/ordinary municipal pages not implicitly licensed; no additional app/database restriction found in scoped item | Only three public-smoking KML Points; toilet/polygon data and newer unrepresented site not public |
| Minato | Source/catalog/raw URLs, use date, changes; no false city authorship. Same-host content only; third-party/external content needs its own rights. Annex excludes GTFS/baby stations, not this resource | 114 reviewed smoking rows; uncertain 109 and other facilities excluded; catalog terms explicitly allow commercial reuse |

Primary pages/legal codes were rechecked 2026-10-05. The web summarizer omitted license sections/images
or failed to open Minato/Koto pages; direct unauthenticated Node GETs returned HTTP 200 and exposed
the exact Taito notice, Osaka 2.1 JP image target, Musashino 4(2) license block, Minato terms/annex and
Koto `license_id=CC-BY-4.0` plus exact station resource binding. No search snippet established approval.
Fixture provenance remains the evidence for the **imported** bytes; upstream data was not reingested.

## 4. Exact live attribution and app presentation

All six `GET /v1/spots/<id>` returned HTTP 200. `sources[].licenseName`, `licenseUrl` and
`attributionText` matched both live registry and reviewed bundle, byte-for-byte as strings.
These are public representative spot IDs, not user/device identifiers:

| Source | Representative spot | API / registry / bundle |
| --- | --- | --- |
| Taito | `sp_09DNJPG81W1HZ0F1JMH80WDY64` | PASS |
| Osaka | `sp_0031BFGP0PERQJXNS5C6PJ9XA6` | PASS |
| Koto | `sp_19B4RBMJ4BYT4RVYPAX05375W0` | PASS |
| Kyoto | `sp_0J64HXF1Q5CAQH7E3Q1YGPEKBK` | PASS |
| Musashino | `sp_218ZG8A5YV74SCKXVKKC5ETHD8` | PASS |
| Minato | `sp_025XR5KASG2CSJJGSRVR2FCE71` | PASS |

Exact attribution text (license links are also the separate DTO `licenseUrl` values in §3):

### 台東区

台東区 CC-BY表示4.0国際 本作品の内容について、台東区は一切保証しないものとする。 元データ https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv

### 大阪市

出典：大阪市「マップナビおおさか 施設情報ポイントデータ（環境・リサイクル）」 https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html 元データ https://www.mapnavi.city.osaka.lg.jp/osakacity/osakacity/opendatafile/map_1/CSV/opendata_1012.csv CC BY 2.1 JP https://creativecommons.org/licenses/by/2.1/jp/ 本ページに掲載しているデータの使用で生じた結果等については、大阪市は一切の責任を負いません。MannerPathが大阪市指定喫煙所を抽出・正規化して作成。

### 江東区

このデータベースは、以下の著作物を改変して利用しています。公共喫煙所一覧（駅前）、東京都・江東区、クリエイティブ・コモンズ・ライセンス 表示4.0国際 https://creativecommons.org/licenses/by/4.0/ 元データ https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv MannerPathが抽出・正規化して作成。コンテンツ提供者は内容を保証せず、利用により生じた損害について責任を負いません。利用規約 https://portal.data.metro.tokyo.lg.jp/terms/

### 京都市

出典：京都市オープンデータ「京都市等の施設に関する情報（一覧表）」施設情報一覧（令和８年９月３日現在） https://data.city.kyoto.lg.jp/dataset/00003/ 著作権者 京都市 クリエイティブ・コモンズ・ライセンス 表示4.0国際 https://creativecommons.org/licenses/by/4.0/legalcode.ja MannerPathが喫煙場所カテゴリを抽出・正規化して作成。京都市は本データの利用により生じた結果について責任を負いません。

### 武蔵野市

出典：武蔵野市「4(2)トイレおよび路上禁煙エリア・公衆喫煙所 令和4年版地域生活環境指標」 https://www.city.musashino.lg.jp/shiseijoho/tokeishiryo/chiikiseikatsu_kankyoshihyo/1040384/1040390.html 元データ https://www.city.musashino.lg.jp/_res/common/opendata_kikaku/toilet.zip CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ MannerPathが公衆喫煙所のKML Pointを抽出・正規化して作成。武蔵野市による推奨・保証を意味しません。

### 港区

出典：港区オープンデータカタログサイト「複合施設・男女平等参画施設・その他の施設」 https://opendata.city.minato.tokyo.jp/dataset/minatokushisetsujoho_fukugo 元データ https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/02705cbf-d01a-4f32-98c1-05329a11d316/download/minatokushisetsujoho_fukugo.csv （2026年9月30日に利用） CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ MannerPathが指定喫煙場所を抽出・正規化して作成。

Repository UI path checked without code edits: `TileSpotMapper` preserves license/attribution;
`SpotDetailView` uses detail `verification.sources` (nearby sources as fallback), then
`NearbyAttributionView` displays the full attribution, license name and HTTP(S) license link.
The cached sources/about route uses the same view. `WatchSnapshot`/`PhoneWatchSync` preserve the strings;
Watch `ContentView` renders source, license name and attribution as text, **not a license hyperlink**.
The URL survives in the snapshot but is not separately displayed there; Taito's attribution itself has
no license URI. Adequate Watch access to the license via the companion iPhone must be documented or
fixed in separately approved work before declaring §3(a)(1)(C)/§3(a)(2) coverage complete.
Existing #186 Release simulator
evidence confirms production detail/attribution connectivity, not new visual proof for each of these six spots.
**No six-source signed-archive/iPhone/Watch visual or license-link interaction test was run in this audit.**
Maintainer must confirm full, untruncated/readable notices and usable source/license links in the submitted build;
source URLs in attribution text are not asserted to be individually tappable links by this code inspection.
MapKit's own displayed credit must remain intact; municipal licenses do not license Apple map imagery.

## 5. Unresolved Taito modification indication (P1)

[CC BY 4.0 §3(a)(1)(B)](https://creativecommons.org/licenses/by/4.0/legalcode.ja) requires indicating
modifications; §3(a)(2) allows a reasonable contextual presentation. §2(a)(4) distinguishes necessary
technical format changes from creation of adapted material. This audit does not decide the legal
classification or copyrightability of individual municipal facts.

Observed engineering evidence: `services/api/src/pipeline/taito.ts` extracts/normalizes source values;
`taitoAttenuations` conservatively weakens hours/lifecycle/publication using the reviewed conflict reference.
The prescribed four-element attribution is retained exactly but does **not** identify MannerPath's changes.
The iPhone/Watch source views add no separate modification notice; uncertainty labels and internal
provenance do not demonstrate that recipient-facing condition. Independent reviewer inspection agreed.

Consequently the earlier four-element wording approval (#22) and today's exact metadata match are
**not** treated as a complete CC change-notice determination. Before declaring all rights conditions met,
either document a qualified rights determination that the existing presentation satisfies the requirement,
or approve a focused separate notice identifying extraction/normalization/conservative hours handling,
preserving the prescribed wording and verifying its recipient-facing coverage. A future implementation
and any deployment/artifact update need their own approved scope; this audit makes none.
The separate Watch license-access gap in §4 also requires a documented contextual sufficiency
determination or a reviewed UI remedy; merely storing the URL in `WatchSnapshot` does not display it.

## 6. Excluded sources and final owner checklist

- **OSM:** [ADR-0010](adr/0010-osm-odbl-production-architecture.md) permits reference-only research,
  prohibits canonical/attenuation/promotion OSM values and keeps publication blocked. There is no `osm`
  row in live `sources`, no OSM/userReport field provenance or published entity link. No ODbL corpus assertion.
- **Community:** [#124](https://github.com/Kounishiyuuki/MannerPath/issues/124) remains OPEN with rights
  approval pending. `COMMUNITY_PUBLICATION={state:"pending"}` and registry source blocked; production
  has no community source/data lineage and zero community published spots. Reports/photos remain unavailable.
  Do not equate technical readiness, draft terms or report-store migrations with rights approval.
- **Other candidates:** all six live sources are approved and known; no unreviewed/unknown-license/blocked
  source contributes public fields. Koto park, uncertain Minato point, Kyoto conflicting rows and Taito
  holds remain excluded. Ordinary web/map content is only subtractive review/reference, never a value source.

Submission handoff:

- [x] Actual 513/six-source corpus and exact reviewed releases confirmed, license metadata and six representative API notices matched.
- [x] Commercial reuse/derivation/redistribution permission basis documented; OSM/community/blocked source contamination absent.
- [ ] Resolve Taito P1 change-indication evidence gate (§5); do not merely sign it away.
- [ ] Resolve Watch license-access evidence gap (§4), then verify all six notices/license access in final signed iPhone/Watch surfaces and offline cache; preserve MapKit credit.
- [ ] Maintainer confirms shipped icon/screenshots/assets, storefront rights and downstream EULA/technical restrictions do not contradict source licenses; handle ward contact request.
- [ ] Maintainer records final legal/rights signoff and only then enters ASC's necessary-rights declaration.

No license-unavailable municipal source was found. **Not yet “maintainer signoff only”:** the Taito notice
gate and Watch license-access gap remain, plus final-build/asset checks. This result does not reopen OSM or community legal work as a v1
corpus prerequisite, and authorizes neither production changes nor ASC submission.
