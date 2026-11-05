# v1.0最終提出文書レビュー — 2026-11-05

**SUBMISSION: BLOCKED。** v1.0は写真なし新規申請ありで確定。写真はv1.1以降。
全項目の4分類と優先ブロッカーは[公開要件総点検](REQUIREMENTS_AUDIT.md)を参照。
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

## 1. 提出資料と公開説明の一致

| 対象 | 結果と残件 |
| --- | --- |
| App Store説明/Review Notes | 写真なし、pin/重複/条件/規約/同意/受付、独立した根拠での審査、自動掲載なしを明記。地域は過去観測由来で当日確認待ち。Watch/Widgetの実機PASSなし |
| Privacy Policy | リポジトリ`site/privacy/index.html` §5は初回read-only版・報告/端末登録/写真停止の原稿。申請ONの提出文面とはまだ一致しない。公開頁の再取得や改変はしていない。運営者がtext-reports候補の収集/保持/backup説明を承認後、別担当がja/enを更新・公開確認する |
| Support | `site/support/index.html`の初回版申請不可の原稿も更新が必要。位置/条件の申請、審査待ち、写真添付なし、再install≠サーバー削除を案内する。未提供の履歴復旧/削除ボタンを約束しない |
| 通常申請規約 | `docs/legal/REPORT_TERMS_CANDIDATE.md`は未承認。対象pin/本文/識別情報・審査/再利用・非遡及同意は方向が一致。§6の90日削除表現はSQL最小化/復元履歴/認証登録等の残存と照合、§8の撤回案/本人確認と未決マーカーを運営者/法務が確定する。report IDが必要でもそれだけで十分とはしない |
| App Privacy/manifest | 本文・pin・Device IDをCollected/Linked/Not Tracking案で維持。support/email包括案とログ不確実性は別。写真型除外と候補manifestは未承認・未組込。最終archive Privacy Reportとの一致は未確認 |
| 旧写真資料 | 旧「1〜3枚必須」はv1.1索引とscope上書き注記のある履歴/候補だけに保持。現行のdescription/notes/実行シートに写真stepはない。旧資料をv1.0へ転記しない |

**公開policy/supportに停止文が残ったまま申請ON版を提出しない。** このPRではURL設定を変えず、公開内容の一致を承認済みにしない。

## 2. Collected / Linked / Not Trackingの根拠

#374の通常reportはApp Attest v3封筒から、installId、冪等キー、確定pin、規約版、任意本文/観測日/claimを受け取り、
REPORTS_DBへpendingとして保存する。写真fieldは持たない。submitter hashはApp Attest key由来で、写真なしでも同じinstallの
報告を関連付けられる。pinは5桁で利用者が明示選択した現在地と一致し得る。90日までの審査用保持はリアルタイム処理を超える。
したがってOther User Content、Precise Location、Device IDはCollected/Linkedの回答案とする。
無アカウント・hash化・毎回同意だけではNot Linked/開示例外にならない。
正本仕様の文言残件：#374のdocs/API.mdには「端末の位置を送ってはならない」との旧文言が残る一方、
#375は利用者が現在地をpinとして明示選択・確定する。自動GPS送信と明示確定pinを区別するようLane3で正本を整合する必要がある。
提出候補のPrivacy回答は実際に送られるpinに基づき、非収集へ変更しない。

目的は審査/不正対策のApp Functionality。アプリに広告・IDFA/広告計測SDKはなく、報告を広告/ブローカー用途へ結合するflowは
見つからないためNot Tracking案。providerの実用途・保持・転送は運営者が確認する。IP/tile/ログやsupport/emailを写真延期で消さない。
[Apple Privacy定義](https://developer.apple.com/app-store/app-privacy-details/)を2026-11-04再確認した工学上の評価で、法務承認やASC回答済みではない。

`retention.ts`は90日で本文/pin/submitter hash等を最小化するが、skeleton・列挙claim・receipt/監査とApp Attest登録は別。
#374の独立確認行（report ID、basis、公式URL、確認日、operator ID、時刻/hash）もimmutableな監査記録で、全記録90日削除ではない。
D1履歴/exports/restore再適用・support・認証登録の期限と削除依頼処理はG2/G3/G23で確定する。
#382の再送は同じpayloadを使い新しい収集型/利用目的を追加しない。要求回数とproviderログが増える可能性は既存の未確認事項に含める。

## 3. Photos除外条件

**stagingの一部確認あり、最終条件は未完了。**

| 証拠ID | 操作/確認（許可された環境のみ） | 合格証拠・現在の不足 |
| --- | --- | --- |
| RELEASE | 提出する署名ReleaseのSHA/build/hash・bundled terms・構成を固定。新規申請を最後まで実行 | #375は`.reviewed()`の空photo termsで通常写真UIを閉じる設計。最終binaryのpicker/写真数/送信/retryなしを録画・通信で確認。ソースだけでは未合格 |
| LEGACY | 同RCで旧draft/受理後photo-follow-upがある移行・復元状態を試験 | #375 HEADはfollow-up読込/入口表示が残る可能性がある。新規installの成功だけでは不足。写真再送入口なしを実証、必要ならLane1がguard修正。旧keyでuploadできないことと入口非表示は別 |
| CONFIG | 実際にRCが接続する環境・Worker版・configを対応付ける | `reports.available:true`、App Attest protocol、`photoEvidenceEnabled:false`、通常terms一致。photo bindings/allowlist/別routeの有効化なし。staging configはavailable=true/App Attest/v3/photos=falseの実施記録あり。提出Releaseとの一致・本番設定は未確認 |
| PHOTO_API | 隔離stagingで承認済みテストを実施 | #374の`new-spot-independent-evidence.test.ts`はphoto routeの503 `photoEvidenceDisabled`とDB写真0行を固定。stagingの503拒否・smoke成功は記録あり。最終RCのupload/retry拒否・保存なしの照合は残る。個人写真やdummy本番申請を送らない |
| PAYLOAD | 同一署名Release→staging送信のpayload/サーバー受理を照合 | strict report payloadはphoto field/bytesを含まない。未知写真fieldの拒否、本文/pin/IDのみの受理、同じ冪等reportへの再送を確認。ログに本文・pin・鍵・assertion・写真を残さない |
| SUPPORT | サポート添付/運用preview/export/provider経由を確認 | Gmailなどで写真を保持するflowがある場合、アプリ内写真offでもサービス全体のPhotos非収集としない。実workflowとして申告を再評価。運営者確認が未了 |

CONFIG/PHOTO_APIはstaging実施記録によるPARTIAL、RELEASE/LEGACY/PAYLOAD/SUPPORTはNOT RUN。提出対象の最終条件は未完了。
単に`photoEvidenceEnabled:false`またはmanifestにPhotosなし、だけでは全条件を満たさない。
結果/日時/RC・API版・担当・private証拠参照を保存し、JSONの`conditionsVerified:false`は実証と承認まで維持する。
現mainはphoto routes/PoCを保持するため、未使用コードの存在だけで収集とも、UI非表示だけで無収集とも断定しない。

## 4. 独立した根拠と自動掲載の禁止

#374は写真なし新規地点の承認、review提案、exportに`officialSource`の公式https情報または`siteVisit`の
運営者による確認記録を要求し、migration0011がDB exportでも検査する。
最新#374は`place_confirmed = 1`（そのpinに喫煙可能場所があるという明示確認）も必須とする。記録しただけでは承認しない。
URLの形式がhttpsであることは、そのページが公式/現行である証明ではない。施設/地点・利用条件・位置・確認日との一致は
運営者が原本で検証する。店舗や灰皿の存在だけで喫煙許可を推定しない。申請者の自由文だけを独立根拠としない。
source/rights/位置精度/品質・独立性・規約権利・後段公開手続きも残る。受付・独立確認・承認・公開を区別する。
今回、確認記録の作成/承認/export/公開は実行していない。

## 5. 提出までの必要条件と順序

1. **P0・運営者判断**：[決定表](OWNER_DECISIONS.md)の#124・Privacy・運用条件を承認または修正。未承認のまま本番受付を開かない。
2. **P0・現実装の仕上げ**：最終RCで写真/legacy入口非表示、manifest/Privacy Report、規約version/bytes/hash、公開policy/supportを一致させる。main統合は完了しており再度の未統合扱いは不要。
3. **P0・残る検証**：既に成功した実機201を全やり直しの条件にはしない。未実施の応答消失・同一申請再送、独立確認→承認→review/export、失敗/復旧を隔離stagingで検証する。現在停止中の再開は別承認。CPU余裕・1102・IP制限429は実測し、未観測なら制限の有効性を主張せず、無料枠で安全に運用可能か判断する。有料化を既定の解決策としない。
4. **P0・最終提出物**：同一署名Releaseで位置権限/オフライン、iPhone/Watch/Widget、App Group・App Attest、写真除外条件、承認済みcorpus/画像を確認。G18の実機AX/VOはP1として完了または明示受容し、証拠なくアクセシビリティ対応を申告しない。#367の失敗は現RCで製品影響を切り分ける。
5. **P0・運営者作業**：承認済みPrivacy/Support/規約を別担当が公開し、別途承認された本番0011/設定・監視・停止手順を確認。通常申請ON/写真OFFと提出文言を一致させる。ASCの連絡先/Privacy/UGC年齢/権利/輸出/地域/無料/画像/buildを入力し、全P0完了後に提出判断する。本PRでは実施しない。

## 6. v1.1以降へ分離（v1.0 P0へ追加しない）

- 写真添付・写真暗号化/鍵破棄・写真専用規約/ストレージ検証。再有効化しない。
- 申請履歴画面・セルフサービス削除/復旧endpoint、バックグラウンド自動再送の拡張。
  ただしv1.0でも現実装で履行可能な手動削除相談・本人確認・保持説明は必要。
- 2名承認・新地域追加・アプリ内地域一覧。現行の独立確認・権利/位置/品質ゲートは維持。

実際の承認/exportのstaging検証は将来機能ではなく、既存v1.0運用の残件。P1は運営者の明示受容なしに省略しない。
