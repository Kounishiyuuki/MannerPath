# v1.0公開要件総点検 — 2026-11-05

**SUBMISSION: BLOCKED。** 写真なし新規地点申請あり、写真はv1.1以降。go/no-goは[Release Gate](../../../V1_APP_STORE_RELEASE_GATE.md)。
## 最新状況（2026-11-05）

main `2e0eec7`へ#374・#375・#382（旧#381の再送実装）が統合済み。
証拠はmain上の自動テスト記録と2026-11-05の運営者報告。このLaneは実機・remote操作を再実行していない。

| 区分 | 確認できた範囲 | 未確認・限界 |
| --- | --- | --- |
| 実施済み（運営者報告） | 実機App Attestで写真なし申請201。stagingに2件保存、pending、未掲載 | 最終提出Release全体のPASSではない |
| 自動テストのみ | 冪等性、独立確認必須、審査・export制限、限定v3再送 | 実機の特殊な応答消失、staging実承認・exportは未検証 |
| 実施済み（構築/停止） | REPORTS_DB0011、合成データ、readiness/security-smoke成功。その後App Attestを無効化し受付停止・fail-closed確認 | 過去のavailable=true/登録pausedは試験時点。現在の受付稼働を意味しない。本番は未変更 |
| 未確認 | 十分なCPU余裕、1102時の実機復旧、CHALLENGE_RATE_LIMITERの429 | 成功受付やbinding存在から安全余裕・IP制限成功を推定しない |
| 未完了 | #124、最終署名Release・iPhone/Watch/Widget・提出素材・ASC・本番有効化 | 未承認・未検証を完了扱いしない |

合成データはストア素材に使用しない。実機2件の成功は写真非収集6条件やprivacy承認全体の代用ではない。
[運営者の決定表](OWNER_DECISIONS.md)と下記の残件に従う。

## 判定方法

- **実装・検証済み**：記載したHEAD・対象テスト・fixture/Simulator/ローカル範囲だけ。実機やリリース全体のPASSではない。
- **実装済みだが実機確認待ち**：コード・限定自動検証はあるが、提出RCの署名端末で期待動作を観測していない。
- **運営者承認待ち**：法務/運用/ASC/素材判断。コードやCIで代行できない。
- **未実装・要修正**：実装不足、統合/資源準備、または未解決の検証失敗の切分けが必要。機能未実装とテスト失敗は理由欄で区別する。

同じ機能でも自動検証と実機を別行にする。未統合PR上の実装は明示し、mainや配布済みbuildの完了へ転記しない。
状態の割合や総合PASSは算出しない。写真延期は通常申請の規約/権利/審査ゲートを免除しない。

## 要件別分類

| 項目・検証粒度 | 状態 | 証拠・限界／閉じるための作業 |
| --- | --- | --- |
| 地図/一覧→地点選択/詳細→Apple Mapsの対象自動ケース | 実装・検証済み | [#349](https://github.com/Kounishiyuuki/MannerPath/pull/349)の両OS N PrimaryFlow報告、`PrimaryFlowUITests`。指定ケース・当時HEAD限定 |
| 地図/詳細/利用条件/出典/経路の最終RC | 実装済みだが実機確認待ち | matrix P10/P14、位置精度/unknown/出典と実Maps handoffを現RCで観測。build2の過去PASSを新RCへ移さない |
| 入力中検索、候補選択、旧応答排除、retryのmodel/fixture | 実装・検証済み | `RouteSearchTests` liveSearch群、`DestinationSearchUITests`。#349の18.6 Workerなし6件報告。実MapKit全状態の証明ではない |
| 現在地・When In Use・拒否/再許可・fresh fix | 実装済みだが実機確認待ち | current-location model/pin実装あり。実GPS/権限/精度/freshness・復帰はmatrix P4等で確認 |
| 現在地をpinへ明示選択するUIの失敗切分け | 未実装・要修正 | 機能は実装済みだが[#367 Nov1追記](https://github.com/Kounishiyuuki/MannerPath/issues/367#issuecomment-6558777664)で単独失敗・未変更mainでも再現。環境だけが原因と確定していない |
| 目的地選択/解除/再検索 | 実装済みだが実機確認待ち | #349対象成功履歴と`NearbyLocationModelTests`。現RC実機の解除/再検索/遠方距離表示待ち |
| AX5 DestinationClears等の順序依存失敗 | 未実装・要修正 | #367はbatch失敗→単独成功等を記録。最終統合HEADでfresh fixture/Simulatorと結果bundleを用いて切分け。今回Simulator操作なし |
| フィルタunknown保持/openNowのunit規則 | 実装・検証済み | `RouteSearchTests.confirmedFiltersPreserveUnknownAndNoAsDifferentValues`、`openNowRequiresParsedKnownHoursAndOfficialEvidenceRequiresVersion`。不明を許可/open扱いにしない |
| フィルタ操作/空filter解除の対象Simulator | 実装・検証済み | [#368](https://github.com/Kounishiyuuki/MannerPath/pull/368)：18.6 Menuを開くテストを修正、対象単独/Native+J成功。26.5対象単独成功。全filterの実機PASSではない |
| フィルタ全種/空から復帰/keyboard共存の現RC | 実装済みだが実機確認待ち | filter種類/アクセス/たばこ、不明を含め実機確認。過去mainのPhysicalTypeFilter/EmptyFilter失敗をすべて解消済みとは認定しない |
| 空エリア/キャッシュなし/保存済みofflineのmodel・file | 実装・検証済み | `NearbyPersistenceE2ETests`、`NearbyLocationModelTests`、C_OfflineWithCache/D_CleanOffline。fixture・ファイル単位の履歴 |
| 空エリア/地図申請入口/目安clusterの未解明UI失敗 | 未実装・要修正 | [#367 Nov3追記](https://github.com/Kounishiyuuki/MannerPath/issues/367#issuecomment-6587729787)のB EmptyArea/MapReportButton、Nov1のG approximate cluster失敗。製品bugか試験前提か未分類。Worker停止によるG add-place失敗とは分ける |
| 実機offline/再起動/cacheなし/古さ・遠方徒歩なし | 実装済みだが実機確認待ち | 機内モード・再接続・実経過で記録。空/通信失敗/保存済みを区別しoffline徒歩経路を約束しない |
| iOS18.6/26.5 AX5 pin Directions/Clear重なり修正 | 実装・検証済み | [#371追記](https://github.com/Kounishiyuuki/MannerPath/pull/371#issuecomment-6558777877)：最長fixture名を選び両OS成功・画像確認、mainに統合済み。特定製品bugの修正証拠 |
| iOS18.6/26.5全UI回帰 | 未実装・要修正 | #371の対象成功や#375 I+J 26件両OS成功をfull-suite全成功へ拡張しない。#367 OPEN。初期タイトルの「full-suiteのみ」は後の単独失敗で更新が必要な履歴 |
| 実機AX5/VoiceOver/dark/keyboard/Reduce Motion | 実装済みだが実機確認待ち | [申請統合記録](../../../research/2026-10-29-report-submission-integration.md)は旧HEADの限定Simulator証拠。実VO音声/gesture/順序や現署名RCの大文字は未確認 |
| Watch未同期/正常0件/通信失敗/stale/revision/timeout | 実装・検証済み | [#340](https://github.com/Kounishiyuuki/MannerPath/pull/340)のunit/fixture・Debug/Release境界。`WatchSyncRefreshTests`/`WatchSyncTests`。実WCSessionではない |
| Watch同期/位置/権利/再接続/圏外cache | 実装済みだが実機確認待ち | [Watch実行表](../../WATCH_WIDGET_RELEASE_READINESS.md)はhardware全行NOT RUN。目的地検索をnearby同期としない |
| Widget保存file/鮮度/deeplinkのunit | 実装・検証済み | `NearbyGlanceTests`とfile roundtrip。App Groupの各端末内共有とWC橋渡しは別。署名共有の証明ではない |
| iPhone/Watch Widget/Smart Stack/更新遅延 | 実装済みだが実機確認待ち | signed App GroupとWidgetKitの実時刻待ち。Watch Widgetは保存したiPhone候補順で、WatchのGPS/フィルタによる並べ替えとは一致しなくてよい |
| 写真なし新規申請/重複/規約必須/受付/再送の自動検証 | 実装・検証済み | 統合済み #375の`ReportNewPlaceWithoutPhotosTests` 11件、I+J両OS26件報告。量子化pin範囲・400説明・未署名拒否・掲載保証なしも追加。main統合済み |
| 本文/pin/terms/App Attestの実機受付→再起動/再送 | 実装済みだが実機確認待ち | 実機App Attestで201、2件pending/未掲載は運営者確認済み。応答消失/再起動/再送、最終署名Releaseは未確認 |
| 不正申請防止・独立確認・review/export/rollbackの自動検証 | 実装・検証済み | 統合済み #374：attestation/上限/範囲外、cut-off冪等再送、immutable/CAS/期限、0011既存DB/rollback、headless admin操作の報告。公式source/現地のplace_confirmed必須。main統合済み |
| #382の限定v3自動再送 | 実装・検証済み | 統合済み #382は同payload/冪等キー・新challengeで最大2回追加、busy/backoff後に手動再送。対象unitと18.6/26.5の再送UI報告あり。実機1102/自動回復は未検証 |
| staging構築/0011/合成readiness・smoke | 実装・検証済み | #374 §8/8.1と運営者報告。合成4地点、readiness completed、security-smoke PASS。実機201の後、App Attest無効化で受付停止・fail-closed確認。最終Release・本番成功ではない |
| 写真なし経路/自動再送のmain統合 | 実装・検証済み | #372/#374/#375/#382はmain統合済み。最終統合回帰、同意/manifest/legacy状態の整合が必要。本番0011/設定は別承認 |
| Workers Free tail/1102監視・有効化 | 運営者承認待ち | #374最新P50 6ms/P99 35ms、>10ms 5%、exceededCpu0。成功率観測は常時CPU閾値内の証明ではない。staging再計測/監視とtail扱いを承認 |
| v1.0で旧写真follow-upまで入口なし | 未実装・要修正 | #375にもlegacy follow-up読込/入口が残る可能性。空reviewed termsはupload拒否とclean UIの根拠で、legacy表示の証明ではない。guard/移行方針と実機負例が必要 |
| 申請pin/本文/端末IDのCollected/Linked/Not Tracking案 | 運営者承認待ち | [Privacy JSON](app-privacy-candidate.json)：実flowはD1審査保持、App Attest由来hashとの関連。無account/hashは匿名化ではない。purposeはApp Functionality案、provider実用途確認待ち |
| Photos除外、ログ/IP/support保持の確定 | 運営者承認待ち | [6検証条件](FINAL_REVIEW.md#3-photos除外条件)のCONFIG/PHOTO_APIはstaging一部確認、その他/最終条件は未確認。support添付も対象。photo flagだけで非申告しない |
| API正本の位置説明 | 未実装・要修正 | #374 docs/APIの旧「端末位置は送信禁止」を、#375の明示選択/確定した現在地pinと整合する必要がある。自動GPSアップロードと区別し、提出PrivacyのPrecise Location案は維持 |
| 最終Privacy manifest/Privacy Report/公開policy整合 | 未実装・要修正 | 候補plistは未組込、現iPhoneは収集型未宣言。公開用policy/support原稿は申請停止。変更は別担当。G2/G3/G13 OPEN |
| 保持90日最小化・復元履歴・認証登録・監査/削除方針 | 運営者承認待ち | `retention.ts`は本文/pin/hash等を最小化。全記録/媒体消去ではない。App Attest登録・独立確認・receipt・D1履歴/exports/supportを別承認 |
| 早期削除endpoint/本人確認/履歴復旧 | 未実装・要修正 | ADR-0021は設計。機能自体を暗黙にv1.0必須へ追加しないが、現実装で履行できる請求対応/期限の法務承認は必要。再installはサーバー削除ではない |
| 通常申請規約/再利用権・EULA | 運営者承認待ち | #124未承認、MAINTAINER入力/撤回/本人確認/90日とbackup表現未決。新versionとclient/server本文hash一致、非遡及同意が必要。写真条項はv1.1 |
| App Store説明/Review Notesの文面作成・制限検査 | 実装・検証済み | 現候補に写真なし・独立根拠・非自動掲載・限定再送の全文と候補整合テスト。未配備機能が利用可能という本番確認ではない |
| 最終地域文/スクリーンショット/審査動画 | 運営者承認待ち | 実公開corpus当日照合・最終RC native画像・素材/地図権利・実機撮影待ち。旧build3/fixture画像を新RCへ付け替えない |
| 年齢区分/UGC/最低利用年齢 | 運営者承認待ち | 写真なしでもUGCあり。旧reports-off UGC=Noや予想ratingを確定値としない。現ASC質問票とApple算出結果を確認 |
| コンテンツ権利/出典・加工表示/licenseリンク | 運営者承認待ち | 実装・過去bounded監査はあるが、現corpusと署名iPhone/Watchの実リンク・素材権利・法務signoffが未了 |
| 輸出コンプライアンス | 運営者承認待ち | 最終client/暗号library/配信地域を確認しbuild単位で回答。サーバーphoto PoCだけで免除や「暗号化なし」を決めない |
| Release署名/entitlements/App Group/Debug非混入の最終RC | 実装済みだが実機確認待ち | source設定とpreflightツール、build3署名履歴あり。build7の定性的feedback≠現main/新申請RC。最終archive/IPA hash、全bundle/profiles/実共有/実App Attestは未確認 |
| ASC record/連絡先/Privacy/画像/build/審査設定 | 運営者承認待ち | 今回ASC未閲覧。SKU/権利者/実連絡先、処理済みbuild、日本/無料/手動公開、各回答を運営者が確認・反映。Gitへ個人連絡先を保存しない |

## 重要度順の提出ブロッカー

[最終レビュー§5](FINAL_REVIEW.md#5-提出までの必要条件と順序)にP0の必要条件と順序、§6にv1.1以降の非P0を限定列挙した。
実機App Attest受付・main統合は実施済み。#124、公開説明/manifest、残るE2E・CPU/429、最終Release/Watch/Widget/素材、ASC・本番承認はOPEN。
G18はP1のままで、未確認を自動的に提出阻害P0へ拡大しない。今回操作したのは文書/ローカル検証/Git/PRのみ。

## 公式資料と証拠の扱い

2026-11-04に[Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)、
[年齢区分手順](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/)、
[輸出回答手順](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/)を参照。
法的十分性/審査受理を認定せず、運営者の現質問票/最終archive判断を必要とする。
過去のdevice結果は[device matrix](../../../beta-e2e/device-release-matrix.md)、Watch hardwareは全NOT RUNの
[専用表](../../WATCH_WIDGET_RELEASE_READINESS.md)を証拠とする。Issue #367はOPENの検証課題で、環境原因と確定していない。
