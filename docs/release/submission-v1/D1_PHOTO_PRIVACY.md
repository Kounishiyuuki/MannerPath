# D1写真案：Privacyと削除説明の差分

**未承認・設計未決・本番未実装。** 初回監査：2026-10-31、当時のmain `1e2d009`とPR #353を確認。
[Release Gate](../../V1_APP_STORE_RELEASE_GATE.md)のG2/G3/G7/G16/G23はOPEN。
本書はLane 3の方式を決めず、法的十分性も認定しない。公開site/規約/アプリ/バックエンドは変更しない。

## 1. 確認したデータフローとラベル

**2026-11-01再照合：最新main `d3508d5`には#357・#358・#360が統合済み。**
通常の申請経路の`photo-policy.ts`は引き続きR2実装のみ、`REVIEWED_PHOTO_TERMS=[]`。
[#357](https://github.com/Kounishiyuuki/MannerPath/pull/357)、[#358](https://github.com/Kounishiyuuki/MannerPath/pull/358)、
[#360](https://github.com/Kounishiyuuki/MannerPath/pull/360)は初回監査時にはOPENだったPoCで、現在はmainに統合済み。D1/BLOB、binary v3、
暗号helperは通常の申請経路へ接続されていない（暗号helperは隔離probeから使用）。
ソース統合やPoC測定は、方式の正式採用・本番有効化・実環境の消去証明ではない。
以下のデータフロー表は通常の申請経路を記述する。

| データ | mainでの保存・関連付け・目的 | 保持とD1案で再確認する点 |
| --- | --- | --- |
| 写真 | PhotosPicker→端末再encode→App Attest付きreport受理後upload→server再encode→private R2。D1はreport/photo行とhash等。審査目的、一般公開なし | 親report受信+90日が期限、24h前からアクセス停止/削除開始。R2は空marker上書き。D1に写真を移す場合は過去versionと暗号鍵の保持を別に設計 |
| 申請pin | 利用者が移動/現在地を明示選択して確定、5桁に量子化して送信、D1 reportに保存。位置確認/重複審査 | `retention.ts`が90日でNULL化。写真EXIFを除去してもpin収集は残る。D1過去versionは別問題 |
| 本文・自由文claim | D1 report、moderatorが審査 | 90日で本文/host名/hours自由文等をNULL化。列挙claim・report skeleton・監査/receiptは残る。全記録削除とは呼ばない |
| 端末識別 | App Attest key ID/public keyを登録、key由来submitter hashで同一install報告と写真を関連付け、不正対策 | reportのhashは90日でNULL化。登録key/revocationの一律90日削除は実装されていない。登録の保持方針を別に決める |
| 端末内follow-up | report ID/terms version/推定期限/確認済み写真数のみ。画像bytesはアプリで永続保存しない | mainは最長89日。再起動後は写真再選択。D1の前倒し期限を採用するならupload可能期間とは区別して表示を整合 |
| provider/support | tile/IP/運用ログ、Gmailのsender/本文は写真保存方式と独立 | account保持・exports・supportの範囲は未確認のまま。D1移行で解消した扱いにしない |

コード根拠：`services/api/src/reports/{photos,photo-policy,photo-storage,r2-photo-storage,retention}.ts`、
`services/api/src/attest/store.ts`、`apps/apple/MannerPath/MannerPath/Features/Reports/{ReportStorage,AppAttestDevice}.swift`。

[App Privacy回答候補](app-privacy-candidate.json)のPhotos or Videos、Other User Content、Device ID、
Precise Locationは**Collected / Linked / Not Tracking / App Functionality**を維持。
Customer Support/Emailは既存support包括案。D1や暗号化だけを理由に型を削除したりNot Linkedにしない。
運営者が審査時に復号/閲覧でき、report/端末由来IDへ関連付く構成は収集・関連付けが残るという工学上の判断。
[Apple定義](https://developer.apple.com/app-store/app-privacy-details/)は保存先の製品名ではなく実際の収集/用途で評価する。
manifest候補6型は変更不要の案だが、最終実装/Privacy Report/承認済みASC回答との照合は未完了。

## 2. Cloudflare一次情報（2026-10-31確認）

| 一次情報 | 確認事実 | 今回断定しないこと |
| --- | --- | --- |
| [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | 自動で有効。過去時点へ復元可能。復元しても以前のbookmarkは消えない | SQL削除が履歴も消す、履歴窓終了が媒体物理消去証明になる、とはしない |
| [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) | Time Travel窓はFree 7日/Paid 30日 | 実accountがFreeであることや、他のcopy/exportの期限は確認していない |
| [D1 data security](https://developers.cloudflare.com/d1/reference/data-security/) | Cloudflare管理鍵による自動保存時暗号化と転送時TLSを説明 | この保存時暗号化は運営者による写真単位の鍵破棄ではない。運営者もCloudflareも復号不能、とはしない |
| [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/) | location hintは希望regionの保証ではない。jurisdictionとWorker処理範囲は別 | 日本storefront/日本利用者だから日本国内保存、としない。実配備を調べていない |
| [Customer DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) | Customer Contentの処理者としての役割、指示/再委託/削除・返却等の契約を記載 | 契約終了時の削除規定を、稼働中のSQL行削除直後の全媒体消去保証と読まない。実契約の適用確認は運営者 |
| [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/) | End UserのIP/traffic等の処理と、Customer Contentのprocessorとしての処理を説明 | 本アプリのログ/契約/保持設定を公開文書だけで確定しない |

製品仕様と実accountの事実、法的な越境移転/委託評価を分離する。公式文書は物理消去の完了証明ではない。

## 3. 3種類の削除を分ける

| 操作/状態 | 言えること | 言えないこと・成立条件 |
| --- | --- | --- |
| SQL DELETE/UPDATE、写真bytes上書き/fence | 現在のquery/通常経路で対象内容を使わなくする | Time Travel、free-page残存、exports、operator preview/cache、鍵backupまで消えるとは限らない。`secure_delete`も全履歴の証明ではない |
| 暗号鍵破棄による復号不能化 | 対象の復号に必要な**すべて**の秘密情報が失われた場合に限り、その暗号文を復号できない | 鍵がD1履歴/backup/別端末/Secret/escrowに残る、master keyから再導出できる場合は不成立。物理消去とは別。平文copyは別途除去が必要 |
| 物理的消去 | providerが管理する媒体/copyまで消去された状態 | SQL成功・key破棄・Time Travel窓の終了だけからは証明できない。本作業では未検証 |

#360の案はWorkerで平文を受信した後に暗号化するため、**E2EE**や「Cloudflareは平文を一切受信しない」
とは説明できない。Cloudflare管理EARとも区別する。方式が変われば実flowを再監査する。
photoのみ暗号化しても、D1に平文の本文/pinが残ればその復元可能性は別に残る。

## 4. Lane 3/運営者へ渡す未決事項と受入証拠

1. 保存先/暗号方式/鍵単位・保管者・backup/escrow/rotation/recoveryを決定する。
   「復号不能」は対象秘密鍵の全copyと、共有master keyからの再導出可能性まで確認した後だけ。
2. 起点をreport受信時刻に統一して期限を証明する。#360のstorage epoch由来鍵期限とlate uploadが
   親report期限を超えないこと、共有epoch鍵を消すことで他reportを期限前に失わないことを試験する。
3. SQL削除だけを採用するなら、バックアップの復元窓/処理余裕を含めた期限と文面を決定する。
   #360の9日前leadはFree想定PoCで、確定したD1保持方針ではない。Paidへ変わった場合も再評価。
   90日当日のredactionを行う本文/pinの履歴も対象とする。復元窓終了を物理消去と呼ばない。
4. restore/再importがredacted内容や破棄済み鍵を復活させない手順を、別途許可された隔離環境で検証する。
   遅延upload/cleanup障害/再試行/鍵backup復元/preview平文copyも含める。今回はremote検証を行わない。
5. App Attest登録・receipt/監査・support・providerログの保持と削除対象を別に承認する。
   report IDだけの本人確認は不可。ADR-0021の本人確認endpoint/アプリ画面は設計案で、提供を約束しない。
6. [日英policy候補](PRIVACY_POLICY_D1_CANDIDATE.md)と[support候補](SUPPORT_PHOTO_DELETION_CANDIDATE.md)を
   法務/運営者が承認し、Lane 3の実装と期限・復号不能の成立範囲を照合する。採用しないvariantは公開しない。
7. G7の輸出回答は最終クライアント/リンクlibrary/暗号利用を再評価。サーバー側のPoCがあるだけで
   iPhoneの暗号方式/免除を確定しない。今回`ITSAppUsesNonExemptEncryption`を変更しない。

G2/G3/G23の「D1時の説明案不足」と削除語義の混同を解消する準備作業。
新たなP0 DONEは**0件**。承認/最終方式/実環境証拠待ちを残し、gateを緩めない。
