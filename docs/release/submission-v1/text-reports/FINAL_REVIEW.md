# v1.0最終提出文書レビュー — 2026-11-03

**SUBMISSION: BLOCKED。** v1.0は写真なし新規申請ありで確定。写真はv1.1以降。
main `1fdf89a`、PR #375 `21cb4d5`、#374 `12c745d`、#372 `1b84c9d`をread-onlyで照合した。
各PRは照合時OPEN。ソースレビューと各Laneの自動テスト報告は、配布Release・実App Attest・本番の証拠ではない。
公開Web/ASC/本番API/iOSコードは今回変更・操作しない。

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

目的は審査/不正対策のApp Functionality。アプリに広告・IDFA/広告計測SDKはなく、報告を広告/ブローカー用途へ結合するflowは
見つからないためNot Tracking案。providerの実用途・保持・転送は運営者が確認する。IP/tile/ログやsupport/emailを写真延期で消さない。
[Apple Privacy定義](https://developer.apple.com/app-store/app-privacy-details/)を2026-11-03再確認した工学上の評価で、法務承認やASC回答済みではない。

`retention.ts`は90日で本文/pin/submitter hash等を最小化するが、skeleton・列挙claim・receipt/監査とApp Attest登録は別。
#374の独立確認行（report ID、basis、公式URL、確認日、operator ID、時刻/hash）もimmutableな監査記録で、全記録90日削除ではない。
D1履歴/exports/restore再適用・support・認証登録の期限と削除依頼処理はG2/G3/G23で確定する。

## 3. Photos/Videosを除外できる実証条件 — 全件NOT RUN

| 証拠ID | 操作/確認（許可された環境のみ） | 合格証拠・現在の不足 |
| --- | --- | --- |
| RELEASE | 提出する署名ReleaseのSHA/build/hash・bundled terms・構成を固定。新規申請を最後まで実行 | #375は`.reviewed()`の空photo termsで通常写真UIを閉じる設計。最終binaryのpicker/写真数/送信/retryなしを録画・通信で確認。ソースだけでは未合格 |
| LEGACY | 同RCで旧draft/受理後photo-follow-upがある移行・復元状態を試験 | #375 HEADはfollow-up読込/入口表示が残る可能性がある。新規installの成功だけでは不足。写真再送入口なしを実証、必要ならLane1がguard修正。旧keyでuploadできないことと入口非表示は別 |
| CONFIG | 実際にRCが接続する環境・Worker版・configを対応付ける | `reports.available:true`、App Attest protocol、`photoEvidenceEnabled:false`、通常terms一致。photo bindings/allowlist/別routeの有効化なし。今回production GET/設定確認なし |
| PHOTO_API | 隔離stagingで承認済みテストを実施 | #374の`new-spot-independent-evidence.test.ts`はphoto routeの503 `photoEvidenceDisabled`とDB写真0行を固定。実配備もupload/retry拒否・保存なしを確認。個人写真やdummy本番申請を送らない |
| PAYLOAD | 同一署名Release→staging送信のpayload/サーバー受理を照合 | strict report payloadはphoto field/bytesを含まない。未知写真fieldの拒否、本文/pin/IDのみの受理、同じ冪等reportへの再送を確認。ログに本文・pin・鍵・assertion・写真を残さない |
| SUPPORT | サポート添付/運用preview/export/provider経由を確認 | Gmailなどで写真を保持するflowがある場合、アプリ内写真offでもサービス全体のPhotos非収集としない。実workflowとして申告を再評価。運営者確認が未了 |

単に`photoEvidenceEnabled:false`またはmanifestにPhotosなし、だけでは全条件を満たさない。
結果/日時/RC・API版・担当・private証拠参照を保存し、JSONの`conditionsVerified:false`は実証と承認まで維持する。
現mainはphoto routes/PoCを保持するため、未使用コードの存在だけで収集とも、UI非表示だけで無収集とも断定しない。

## 4. 独立した根拠と自動掲載の禁止

#374は写真なし新規地点の承認、review提案、exportに`officialSource`の公式https情報または`siteVisit`の
運営者による確認記録を要求し、migration0011がDB exportでも検査する。記録しただけでは承認しない。
URLの形式がhttpsであることは、そのページが公式/現行である証明ではない。施設/地点・利用条件・位置・確認日との一致は
運営者が原本で検証する。店舗や灰皿の存在だけで喫煙許可を推定しない。申請者の自由文だけを独立根拠としない。
source/rights/位置精度/品質・独立性・規約権利・後段公開手続きも残る。受付・独立確認・承認・公開を区別する。
今回、確認記録の作成/承認/export/公開は実行していない。

## 5. 運営者の実施順序（手順の提示のみ、操作は未実施）

1. **通常申請の法務/運営判断**：#124の再利用・撤回・本人確認・保持/履歴・運営者/連絡先・新versionを確定。
   写真条項はv1.1へ保留。App Privacy5型/Photos除外条件、UGC/年齢、EULAを承認する。未決はOPEN。
2. **コード/RCを揃える**：担当Laneが#372/#374/#375と#373の整合を最終確認し、別権限の統合手続きを行う。
   migration0011、Releaseでの写真/legacy follow-up無効、manifestとPrivacy Report、同意文書bytes/hash/version一致を確認。
   このLaneはmain mergeやiOS修正をしない。
3. **隔離stagingを準備**：別途許可された運用担当がREPORTS_DB0011とtrigger置換を適用確認、App Attest・登録・edge制限・
   retention/cleanup・監視を準備。写真off。staging/productionを混ぜず、stagingデータをストア素材に使わない。
4. **署名実機staging E2E**：写真なし受理→pending→独立確認→承認→review/exportを検証。再送、範囲外pin、上限、
   未同意/不正assertion拒否、写真拒否、LEGACY、Watch/Widget/オフライン/AX5/VoiceOverを記録する。
   Workers Free CPUの再計測と1102監視を確認。#374の全件ok計測はCPU閾値の常時達成や本番SLOを証明しない。
5. **公開説明/素材を一致**：別担当が承認したja/en Privacy Policy・Support・通常規約を更新/到達確認する。
   提出RCと承認済み現在corpusで画像・審査動画・notesを準備し、出典/素材権利/地域文を確認する。
6. **本番有効化は別承認**：運営者の明示的な有効化承認後のみ、別担当が本番0011/trigger、登録/App Attest/limits/retentionを
   設定・確認し、reports available・photos offとRCの一致/エラー監視を記録する。申請の有効化はデータ公開の承認ではない。
7. **ASCと最終Gate**：運営者が承認済みmetadata/連絡先/Privacy/UGC年齢/輸出/地域/無料/手動公開/最終build/画像を反映。
   当日scope/runtime、P0全完了、P1完了または明示受容を記録する。未完了があれば提出しない。
   Appleへの審査提出・公開はさらに別途許可された操作。本PRでは実施しない。
