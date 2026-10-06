# Spot Detail Phase 3 実装前監査 — 2026-10-07

## 結論と監査範囲

基準: fetch 後の `origin/main` = `d971cd775b49a6078955948ba4a2a3455af9eac1`。
Swift・Xcode・API/schema・backend・データは変更しない文書監査。
実機/Simulatorの画面・VoiceOver検証は今回未実施。コードから確認した事実と実装提案を区別する。

Phase 3は既存データで実装可能。必須API変更はない。ただしデータにない面積/半径のエリア円は描けない。
重大な実装前課題は、概算にも出る赤いexact風pin、欠落precisionの説明、navigationより強い確認CTA、
Detail内にないcache状態表示。これらをPhase 3で解消する。

設計の優先順は DESIGN → DESIGNに記録されたStitch確定方針 → Apple-native → 現行domain。
ただし DESIGN 自身の宣言どおり、データ意味・権利・privacyは SPECIFICATION / ADR の契約を維持する。
Stitchは DESIGN §1/§5/§9 に記録された確定方針を用いた。ライブのStitch再取得・画像比較はしていない。
DESIGNの「Current」は作成時点の記述であり、現在コードの代わりには使わない。

## Current structure（コード根拠）

パスはリポジトリroot基準。中心は
`apps/apple/MannerPath/MannerPath/Features/Nearby/SpotDetailView.swift`。

1. `Form`のheader: 名称 `.title2`、physical type、host、直線距離、areaApproximateだけの説明、方角、距離原点footer。
2. On-site check: evidence確認summary・freshness、報告可能時のみ「ここにあった」prominent Buttonと訂正Menu。
3. Walking directions: device起点の非同期MapKit preview、徒歩時間/距離、Apple Maps handoff Button。
   geometryが2点以上ある場合、220pt Mapに青route線と赤 `mappin.circle.fill` を描く。
   precisionに関係なく終点座標はspotのlatitude/longitude。preview失敗でも直線距離とhandoffは残る。
4. Use and access: 紙/加熱式対応、access/refinement、environment、floor、entrance note。
5. Opening hours: status/raw/parsed schedule/time zone、毎分のopenNow評価。unknownはunknown。
6. Evidence and freshness: tier、独立確認数、community/unknown説明、location note、確認日、freshness、source名、権利画面へのlink。
7. Suggest a correction: available/unknown/unavailable/incompatible/attestationUnsupportedを区別。
   保存reportありは継続導線と注意。navigation titleは「場所の詳細」。

`SpotPresentation.swift` は evidence と precision の別軸を保持。
`ApproximateLocation.swift` の `isExactPoint` は publisherPoint/communityPinned のみtrue。
reviewedDerived・unknown・未認識・nilはすべて「この付近へ案内」。
ただし `locationNote(nil)` はnilなので古いcacheでは精度説明行が消える。publisherPointにも明示的なexact行はない。
`distance(result)` の「約」はareaApproximateのみ。徒歩時間/距離はanchor行きでも通常のlabel。

`ContentView.swift` の `navigationDestination` が `DetailSelection` のresult/area/source snapshotを渡す。
距離原点はdestinationまたはdevice、routeOriginは現行device位置がlast-knownでない場合のみ。
Detailはtile/cache由来のSpotを表示し、開くたびに `/v1/spots/:id` を取得しない。
キャッシュ利用/更新失敗の状態表示は親画面側にあるが、Detail入力にはdata state/sync時刻がない。

## DESIGN / Stitchとの差分

| Current implementation | Target design | Apple-native interpretation | Required change |
| --- | --- | --- | --- |
| generic navigation title、名称はForm先頭 | §5.6 名称をtitleに | inline navigation title＋本文の折返す名称 | 長い名称は本文を完全表示、titleだけに情報を依存しない。UI testの固定title更新 |
| 確認CTAが先でprominent、案内は後方の通常Button | 主行動は案内 | 標準 `.borderedProminent` Buttonをsummary直後 | 案内を上へ、確認/訂正は既存callbackのまま下位へ。二つのprimaryを競合させない |
| precisionがheaderとevidence内に分散 | §5.7 存在確認と位置精度を分離 | summaryで二つのLabel、詳細でも別Section | exact/approximate/unknownを常時明示。evidenceから精度を推測しない |
| 赤い終点pin、「Place」annotation | 概算をexactにしない、officialはneutral | 中立glyph＋日本語label/AX | previewのprecision分岐、anchor到着と実地点到着を区別 |
| 概算radiusなし | Stitch円「約30m」、DESIGNはdata由来 | MapKit overlayは根拠あるgeometryのみ | 今回は円を省略し、neutral area-anchor表現＋説明。30mを固定しない |
| Sources、freshness、precisionが同じSection | 短い主要情報、詳細は下位階層 | Form SectionとNavigationLink | evidence summary/freshnessは上部、確認数/説明/source法律情報は下部。法律情報linkは残す |
| source attribution専用Listあり | §5.17 常に到達可能 | 既存権利画面再利用 | offlineでも削除/ネット取得必須化しない |
| cache stateは親だけ | honest offline state | Detail内の非blocking status row | 親の既存data stateとsync時刻を渡す小さなinterfaceを検討 |
| system font/Form、Detail AX5合格根拠なし | §6 wrap/AX/semantic colours | 標準部品＋必要時縦配置 | 下記matrixで実測。標準部品だけで合格と断定しない |

## Exact detail target

対象は `publisherPoint` / `communityPinned` のみ。officialに限定しない。
上部の読順: 名称 → 直線距離/方角と原点 → 「地点の位置」＋precision由来 → evidence → freshness →
利用条件（顧客限定/施設限定/チケット条件等、unknownを含む） → 「この場所へ案内」。

標準Buttonはsymbol＋全文label、可変高さ/折返し、最低44×44pt。brand背景を使う場合はDESIGN §3/§9に従い
MannerPath Yellow＋黒の内容。SF Symbols/通常linkはsystem色。fixed height/lineLimit(1)/縮小による収容をしない。
下部に利用条件詳細・営業時間・任意の経路preview・evidence詳細/出典link・既存確認/訂正導線。
communityPinnedは現地利用者pin由来と伝え、公式座標と呼ばない。
Map表示は任意だが、PRODUCT_REQUIREMENTS §4のonline pedestrian route previewは維持する。
徒歩時間/距離のpreviewを削除しない。情報/CTAはroute取得の成功に依存しない。

## Approximate detail target

対象は `areaApproximate`。同じForm骨格、存在確認と位置精度は独立Section。
上部に「位置は○○内の目安です」と「正確な位置は未確認のため、ピンは目安です」を表示。
areaNameは既存 `displayableAreaName` で扱い、欠落/不正名は汎用「このエリア」。
存在についてはtierの意味を超える保証をしない。詳細説明にはADR-0017の既存copyを維持し、
communityReportedなら未独立確認の説明も併記して、位置説明でofficial相当に格上げしない。

距離は「約」、方角/直線距離はarea anchorまでの目安。CTAは必ず「この付近へ案内」。
previewの徒歩時間/距離にも「目安地点まで」と説明し、施設内の実喫煙点までの徒歩経路と主張しない。
Maps handoffの直前にも目安地点へ開くことを読める/聞ける形で示す。Apple Maps内の表示はappが保証できない。
赤warning/errorにはしない。`mappin.and.ellipse`＋text、semantic neutral/secondary色。

## Unknown / derived / legacy handling

| precision | 表示 | CTA / map |
| --- | --- | --- |
| publisherPoint | 地点の位置・公開元の地点 | この場所へ案内、neutral point |
| communityPinned | 地点の位置・利用者が示した位置 | この場所へ案内、neutral point |
| areaApproximate | エリア内の目安、正確位置未確認 | この付近へ案内、area-anchor |
| reviewedDerived | 住所からの推定位置 | この付近へ案内、推定と明示。公開を承認する変更はしない |
| unknown / nil / 未認識 / 未知verification version | 位置精度不明 | この付近へ案内、exact glyph/保証をしない |

unknownはareaApproximateと同義ではない。areaNameや施設内存在説明を捏造しない。
既存helperの保守的CTAを再利用し、上部・経路preview・VoiceOverまで同じ意味にする。
unknown距離は「表示座標までの目安」と説明し、preciseな実喫煙点距離と読ませない。

## Marker / pin方針

現在mainの `ClusteredSpotMap.swift` は `tint(selected:)` で未選択systemGray、選択MannerPathYellow、
evidenceはglyph/AXで区別している。DESIGN §5.2の「現在officialは赤」はこのmainには当てはまらない。
残るDetailの赤pinは `SpotDetailView` のWalking directions Map annotation。
これをevidenceで色分けしないneutral表現へ。Detail内の単一終点は選択操作を意味しないため、常時Yellowにしない。
approximate/unknownにexact pinとして描かない。Mapなしのfallbackも許容。
Add Placeのpin・root map selectionの未merge修正はPhase 3で触らない。

## Evidence presentation / freshness

| tier | 現行domainの意味 | 表示方針 |
| --- | --- | --- |
| official | 公式の確認 | 「公式確認」、neutral `checkmark.seal.fill` |
| operator | 運営者の確認 | 「運営者確認」、neutral `checkmark.seal.fill`（textでofficialと区別） |
| communityVerified | 独立した利用者報告による確認 | 「利用者確認」、`person.2.fill`、MannerPath reviewed・非公式の説明 |
| communityReported | 1件の審査済み報告、独立確認なし | 「利用者報告・未確認」、`person.fill.questionmark`、secondary。error扱いしない |
| unknown | このversionでは確認状況不明 | 「確認状況不明」、`questionmark.circle`、unknownのまま |

DESIGN §4のglyphへ寄せる変更は見た目のみ。`existenceTier` fallback/確認数/出版権利gateは変更しない。
確認数は独立確認の詳細でありrewardにしない。存在evidenceとlocationPrecisionの組合せで片方を補完しない。
freshnessは `SpotFreshness` / `SpotPresentation.confirmation` を再利用。day observationとcommunity review monthを分ける。
現状のcommunity `lastVerifiedAt=nil` の「確認日不明」と月のfreshness併記は、月精度のreview labelへ整理可能。
fetch/sync時刻を確認日に置換しない。staleは中立text、非存在/closed/赤warningにしない。
openNowは `NearbySearch.openNow` のyes/no/unknownを保持。unknown/raw-onlyから営業中にしない。

## Source / license preservation（Content Rights）

`NearbyAttributionView.swift` はpublisher displayName、verbatim attributionText（元データURL等を含む）、
licenseName、HTTP(S) license link、`SourceAttributionPresentation.modificationNotice` を表示する。
空source/欠落文言は欠落として表示し、権利承認済みとは主張しない。
URL validation（http/https・host・資格情報禁止）と不正URLのtext fallbackを保持。

Detail linkは `spot.verification.sources ?? nearbySources`。nilだけが近隣cache fallback、空配列とは異なる。
legacy fallbackは「このspotの全出典」と呼ばず「近隣cacheの出典」と明示。
`TileSpotMapper.swift` が sourceIDsをsource recordsへ対応付け、`GRDBTileStore.swift` はSpot JSONと
sources_jsonを保持。表示階層を変えてもattribution本文、加工notice、license linkを失わない。
offlineで本文は読める。外部licenseページのoffline取得を保証しない。

Watch転送は `Core/WatchSync/PhoneWatchSync.swift` の `WatchSnapshotBuilder`。
最大500件のdevice近隣候補についてsourceIDs、evidence、precision、概算areaNameを保持し、参照sourceの
id/displayName/licenseName/licenseURL/attributionTextをsnapshotへ送る。加工noticeは共有presentationのapp文言。
Detail再設計でSpot/source保存やsnapshot builderを変えない。destination corpusをWatchへ再ラベルして送らない。
Watch UI/転送仕様変更はscope外（既存契約保全の確認のみ）。

## API gap

| 必要情報 | 既存契約/cache | 判断 |
| --- | --- | --- |
| 名称・座標・type/access/tobacco/environment/hours | tile Spot → domain/cache | 十分。floor/entranceNote等domain optionalは供給がなければ捏造しない |
| evidence・確認数・review month・precision・area name/kind | API `verification` → mapper → Codable Spot | 十分。legacy欠落はunknown |
| source/加工notice/license | tile sources＋local notice | 十分、ネットdetail fetchを必須化しない |
| 距離/方角/徒歩preview | device計算＋MapKit | API不要、offline route保証はしない |
| cacheOnly/refreshFailed/sync時刻 | 親のlocal state | Detailへのinterface gap。API gapではない |
| field-level provenance詳細 | `/v1/spots/:id` のpublic provenance、現Detailには未接続 | Phase 3不要。raw evidence公開/新fetchは追加しない |
| 正確な捜索半径/境界 | locationAreaはname/kindのみ | 円を必須にする場合だけgap。Phase 3では省略 |

将来円が必須ならfield候補は `verification.locationArea.radiusMeters`（円として審査された場合）または
reviewed boundary geometry。理由: 捜索範囲の実寸を示す。既存座標は代表anchor、name/kindは範囲ではなく、
MapKit viewport/host検索/30m固定で代替できない。仕様・provenance・権利レビューが先であり本監査はfield採用を承認しない。
この項目だけを延期すればAPI/schema変更は不要で、Phase 3全体のblockerではない。

## Offline / reports unavailable

cache表示・更新失敗をDetailの非blocking rowで明示し、sync時刻とevidenceの確認日時を別labelにする。
保存Spotの距離/方角/evidence/precision/attributionとhandoffは残す。
routeなし/失敗のcopyを維持。報告が不可でも閲覧・案内・source linkをdisableしない。
available以外の4状態のcopyを保持し、unknownを「サービス停止」と断定しない。
確認/訂正の再配置は既存callback、saved draft保護、acceptsFindingsによるMenu範囲を維持。
報告form/送信/認証/termsを変更しない。

## Accessibility checks（Phase 3受入条件、今回は未実測）

| 設定 | 必須検証 |
| --- | --- |
| Dynamic Type / AX5 | 日本語・英語、長い名称/areaName/source、狭い画面。両CTA全文がwrap、clip/短縮なし。precision/evidenceが消えず縦scrollで到達 |
| VoiceOver | 名称 → 距離原点/方角 → precision → evidence/freshness → access → CTA。装飾symbol重複読上げを避け、別Sectionの詳細/リンクは個別操作可能 |
| exact/approximate/unknown AX | tier×precision組合せをfixtureで検証。CTAの場所/付近と精度説明を同時に聞ける。unknownに施設内確認を読ませない |
| 44pt | primary CTA、source link、既存確認/訂正Menuのhit targetを44×44以上で実測 |
| Reduce Motion | Detailの新規custom animationなし。Map camera/preview更新が動く場合settingを尊重。Phase 2 cameraは境界確認だけ |
| Reduce Transparency | Form/standard Button/system surfaces。独自blur/glassなし、opaque設定で意味が保たれる |
| Increase Contrast | semantic色、symbol＋text。Yellow背景は黒、secondary説明とmap glyphの可読性を実測 |
| Dark Mode | 同じ読順/階層、system背景/文字、red pinなし。色を失ってもprecisionが判別可能 |
| offline/report unavailable | AXでcache利用と報告可否を別々に読め、案内・出典へ到達できる |

現行 `ApproximateLocationTests`、`SpotPresentationTests`、`SourceAttributionTests` を維持。
UI testsにはapproximate CTA/注記とcommunity非公式の検査があるが、Detail全体のAX5/VoiceOver合格証明ではない。
新titleに伴う「場所の詳細」の固定assert更新、exact＋communityPinned、official＋areaApproximate、nil/未来precision、
stale/month/unknown hours/cache/report不可、ライセンス到達の回帰coverageをPhase 3で追加。
Appleの標準Button・44pt推奨: [HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)。
Dynamic Type参考: [WWDC24](https://developer.apple.com/videos/play/wwdc2024/10074/)。
根拠ある円の描画手段: [MapKit MapCircle](https://developer.apple.com/documentation/mapkit/mapcircle)。

## Phase 2 boundary / implementation blockers

### PR #208 interface review (2026-10-07 follow-up)

Reviewed HEAD: `d3f8efec9ba2cafe3138b6890b5e8cbca94aa44e`, based on #203 main
`d971cd775b49a6078955948ba4a2a3455af9eac1`. #208 is still unmerged; these are verified
interfaces of that HEAD, not claims about main. No Swift changes were made by this audit.
Recheck only subsequent HEAD changes after Phase 2 merges.

Confirmed against code, DESIGN changes in #208, #203 and the #202 API-gap audit:
- Full-screen `ClusteredSpotMap` remains under a native sheet with its own `NavigationStack(path:)`.
- Sheet content uses inset-grouped `List` / `Section`. Only system `.medium / .large` detents;
  no 25% fraction, custom detent or measured collapsed height. Detail push uses large; back uses medium.
- Native `.searchable` submits through existing `model.searchDestination` / MapKit search.
  No new backend query/raw-coordinate transport. Destination model, generation/cancellation,
  device/destination corpus isolation and J/K/L domain paths are unchanged.
- Selected summary directions CTA is text-only at every text size, uses
  `SpotPresentation.navigationTitle` and existing `AppleMapsHandoff.openWalkingDirections`.
  publisherPoint/communityPinned use 「この場所へ案内」; approximate/derived/unknown/nil use 「この付近へ案内」.
- Evidence and precision stay independent. The precision-note helper still omits nil;
  explicit missing-precision explanation remains Phase 3 work.
- Detail initializer/callbacks, `DetailSelection`, distance-origin semantics and fresh-device
  routeOrigin are unchanged. Phase 3 must reuse these interfaces and the navigation owner.

Verdict: **MERGE READY; no P0/P1, required API gap, domain regression or scope expansion found.**
Nonblocking P2 follow-ups:
1. `ContentView.swift:107`: summary scroll observes only selectedSpotID changes. First selection after
   scrolling works; selected-pin re-tap keeps visual selection, but re-tapping that same pin after
   scrolling the summary away does not bring it back. This is an edge of DESIGN §5.5's scroll intent.
   25% detent removal is complete. Track the remaining same-ID scroll interaction separately;
   do not opportunistically rewrite the root shell in Phase 3.
2. `MannerPathUITests.swift:592`: official CTA test uses precision-note presence as an exactness proxy.
   communityPinned has a note yet is exact; nil has no note yet uses the area CTA. Current official
   fixture does not cover those cases. Production helper is correct. Future coverage should use
   explicit precision fixtures, including nil and communityPinned.
Neither is a required #208 pre-merge fix.

Test-report reconciliation (reported results vs independently observed evidence):
- Local UI script phase selection corresponds to 31 test executions; H/I/J/K/L contain six methods.
  Their result bundles were not obtained or rerun in this review.
- M contains one method run externally under five display settings. It checks custom-control 44pt
  frames, hitability and selected-pin AX value. It does not automate real VoiceOver traversal/order.
- AX5 summary test checks reachability, labels and height; it explicitly leaves rendered truncation
  to screenshot inspection. Exact/approximate AX5 full-text screenshots and 44.17/55.7pt measurements
  are Claude-reported evidence, not measurements independently repeated here.
- New List scroll animation disables animation under Reduce Motion; existing MapKit animation
  respects that setting. System surfaces remain; no custom blur/glass. AccentColor/brand assets
  are unchanged. Increase Contrast/Dark/Reduce Transparency claims are consistent with code;
  physical rendering and actual VoiceOver remain manual verification limits.
- `make apple-validate` is independently run on an isolated copy of the specified HEAD;
  its result is recorded in the #207 PR. No #208 branch mutation or merge is performed.

### Local cache metadata clarification from #202

Cache state can be passed into Detail without an API change. An exact last-successful sync timestamp
is not currently persisted in CachedTile: do not invent it from generation/verification dates.
If that timestamp is required, define local metadata first; otherwise show existing cache/update
state. Keep it scoped to the selected corpus, separate from evidence observation/review time.

必要interface（#208で上記確認済み。以下はPhase 3保全要件）:
- stable spot IDによるnavigationと、選択時のresult/area/source snapshotの維持。
- distance原点（destination/device/previous）とrouteOrigin（fresh device）を混同しない。
- reportAvailability/hasSavedReport/onReport/onConfirmStillHereの既存意味を保持。
- summaryとDetailで共通 `navigationTitle` / precision / evidence presentationを使う。
- cache state/取得可能なcache metadataを選択corpusと一緒に渡す。正確なsync時刻は上記のlocal metadata判断に従う。別areaの現在stateをsnapshotに誤付与しない。
- Detail push/back時のsheet detentとselectionの所有者はPhase 2に従う。Phase 3で新しいsheet/navigation shellを作らない。

blocker: 半径付き円だけは根拠不足（省略可）。Phase 2 interface確定・上記unknown/preview意味の統一・
Content Rights保全・AX5実測はPhase 3完了のgate。既存API不足やbackend作業を必須blockerにしない。

## Recommended implementation sequence / Phase 3 scope

1. Phase 2 merge後のmainでDetail callsite・selection snapshot・detent所有を再確認。上記interfaceを固定。
2. presentationのprecision分類/unknown表示を統一、tierと独立する回帰tests。shared helperのWatch意味を変更しない。
3. Form hierarchy/name title/上部summary/単一primary案内Button。報告は既存動作の再配置だけ。
4. exact/approximate/unknown previewを整理、赤pin除去、anchor行きrouteのcopy。根拠なし円は入れない。
5. evidence/freshness/use/hoursとsource/license階層を整理。cache stateを安全に渡し、rightsのoffline到達を確認。
6. fixture/UI tests更新、AX5・VoiceOver・全設定matrixのSimulator/実機確認。
7. `make contract`、`make apple-validate`、`git diff --check` を実行してPhase 3 PR。API変更がなければapi validationは不要。

Phase 3はiPhone Spot Detailと必要なpresentation/callsite/testの最小変更のみ。
この監査は実装せず、既存ADR/契約を変更しない。

## Phase 4へ残す項目

ここでのPhase 4は「今回のDetail後の別作業」であり既存roadmapを再番号付けしない。
Filters追加/整理、残るdestination/search UX、root empty/offline shellの全体仕上げ、Add Place/Report UX、
Watch/Widgetsの見た目とAXは別PR。Phase 2中の作業をPhase 3に取り込まない。
area radius/boundaryの取得・権利・API設計、field provenance詳細画面、精度upgrade運用も別の契約判断。
Share/Bookmark・crowding・Trust Engine・gamificationはv1採用せず、Phase 4の自動承認項目にも置かない。

## この文書のvalidation

要求コマンドは `make contract` と `git diff --check`。実行結果はPRに記載。
Swift diffなしのためApple/API build・UI tests・実機検証は今回実施対象外。
