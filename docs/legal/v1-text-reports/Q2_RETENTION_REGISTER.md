# Q2 保持台帳・請求対応の実態と残件

基準main `93d54ac`（#396統合後）。運営者の[準備方針](https://github.com/Kounishiyuuki/MannerPath/issues/124#issuecomment-6686927248)を確認。
Q1=A、Q2=A条件付き、Q3=既存表示/窓口/予定URLを**準備用**に採用。正式承認・公開権利・施行日・本番有効化は未確定。
本票はソース/実schemaの調査とローカル試験であり、**本番の件数・実処理成功・メール内容を確認した台帳ではない**。

[公開前P0の確定表](Q2_PUBLICATION_P0.md)に、担当・閉じる証拠・状態別の請求対応と、条件付きの最小実装を具体化した。Q1〜Q3の再選択は不要。

## 1. 情報別の保持目的・必要期間・削除可能性

「実装上の期間」と「その期間を保有する必要性/法的根拠」は別。後者が未確認の欄を、単に削除不可だから永久保存と決めない。

| 情報・格納先 | 目的/残る内容 | 実装上の期間・削除可能性 | 必要期間/妥当性の残件 |
| --- | --- | --- | --- |
| `reports`の本文/pin/観測日/submitter_hash/施設名/自由文営業時間 | 審査と不正対策。pinは明示確定した現在地と一致し得る。installId原文は保存しない設計 | received_at+90日で期限、保持処理でNULL化。期限だけでは処理完了しない。receiptも同batch退役。早期実行専用の承認済み機能はなし | 90日の作業基準は採用済み。実Cron/遅延/復旧/担当確認の証拠がP0 |
| `reports`のskeleton/カテゴリ/同意版/時刻/状態 | 件数、審査根拠、再送/同意の追跡 | 90日後も残る。自動削除なし。ID/時刻が残るため一律匿名としない | 必要な審査追跡範囲・終期/見直し・法的根拠を確認 |
| `app_attest_keys`・`app_attest_key_revocations` | 鍵ID・公開鍵・sign counter・登録/失効時刻・理由。端末認証/不正対策。秘密鍵は保存しない | 自動期限なし。失効CLIは将来送信を止めるだけで消去しない。最終利用時刻専用列もなく180日未使用削除は未実装 | 認証と失効防止に必要な期間・関連付けリスク。単純に鍵を消すと再登録/失効迂回の問題があり設計が必要 |
| `app_attest_challenges` | 登録/report用nonce・key参照・発行/期限/消費時刻 | protocolで期限切れを拒否、保持処理でexpires_at経過後を削除。消費しただけでは即物理削除ではない | 失効後の処理完了と監視証拠。nonce原文をサポートへ送らせない |
| `report_rate_windows` | pepper由来識別値・上限カウント・期間。乱用防止 | expires_at経過後の保持処理で削除。1時間/日budgetは利用上限であって全情報の保存期限ではない | 期限到来分の削除完了・最小限の識別値で足りるか確認 |
| `report_idempotency` | HMAC digest・report ID・request fingerprint・受付/退役時刻。二重保存防止 | 90日最小化と同batchでrequest hashをNULL化し410へ。receipt自体はno-delete。digestを自動的に匿名としない | receipt残存の必要期間/法的根拠。期限削除すると旧下書きの再作成が起きるためschema/挙動判断が必要 |
| `report_moderation`・`report_reviews`・`report_review_evidence` | 審査状態・review IDs・report参照・採用位置/分類・担当/時刻/理由 | 元申請の訂正は直接更新不可。取り下げはproposedレビューに限定され、exportedには使えない。export済み根拠の自動withdrawal/消去ではない。evidence FK等がDELETEを拒否 | 継続公開に必要な根拠と個人との関連を分離して見直す。消去/非識別化にはimmutable/参照/再計数の設計が必要 |
| `new_spot_evidence_checks` | report ID・公式URL/現地確認・確認日・recorded_by・operation ID・hash。独立確認の追跡 | 0011のFKとimmutable/no-delete。90日最小化後も残る。既存削除影響ツールの参照漏れを今回修正 | URLや担当者名も個人情報を含み得る。誤記録を任意編集できないため根拠訂正/保持期間を個別判断 |
| `admin_review_audit`・`report_bulk_rejections`・`report_bulk_rejection_targets`・`report_bulk_rejection_completions` | 操作ID・report/photo ID・担当handle・時刻・理由・hash・件数等。審査/一括操作の追跡 | append-only/no-delete。本文は入れない設計でもID/handle/hashが残る。完全匿名とはしない | 監査に必要な範囲・期間と非識別化方式。1年自動削除は未実装 |
| `community_evidence_photos`・`community_photo_requests`・`community_photo_deletions`・`community_photo_deletion_attempts` | 旧/PoC写真のメタデータ・予約・削除キュー/失敗記録 | v1.0の写真受付は無効。行が0とは断定しない。redactionでキューができても物理削除完了ではない。ツールで件数だけ確認 | 履歴/既存物があるなら別途調査し、Photos除外条件を再評価。今回再有効化しない |
| `report_store_meta`・`report_terms_documents`・`moderation_queue_revision`・`report_bulk_store_identity` | store識別・同意文書path/hash・queue revision・操作整合。受付本文とは別 | 基盤/同意証跡として存続。任意削除は整合を壊す。文書そのものの公開名等も含め目的を区別 | 申請削除の対象と基盤/契約証跡を混同しない |
| DATA_DBのcommunity evidence/ledger・配布物 | 審査済み場所の事実・内部report/review参照 | REPORTS_DB最小化とは別、immutable。今回の集計対象外。pendingのまま公開済みcommunity地点があるとは主張しない | 実際の配布/保持先、根拠取り下げ・訂正伝播の追跡 |
| D1 Time Travel・手動export・復元コピー | 障害復旧 | SQL最小化後の過去値が復元履歴に残り得る。物理消去や暗号鍵破棄とは別。実plan/コピー一覧は未確認 | 提供者の復元窓・例外copyの期限・復元後の再最小化。履歴を取得/復元していない |
| Cloudflare/ホスティング/障害ログ | 配信・防御・障害診断。IP/tile要求域等が含まれ得る | ソースはinvocation_logs=false、console logs有効。過去監査はLogpush/plan等403でUNKNOWN。現在の実設定・全保存先/期限は未確認 | ログなし/7日で全消去とは確定しない。担当者の権限内設定監査が必要、本PRは本番に接続しない |
| Support Gmail・相談台帳 | 送信元メール・本文・添付・回答経緯。問合せと権利請求対応 | 運営者本人の管理・受信/返信可能は2026-11-07の本人申告で確認済み。アプリの90日処理とは無関係。保存/転送/添付/削除設定と保管copyは未確認。こちらからメール本文や設定は読んでいない | support側の保持/添付・転送/削除設定と見直し証拠。別アカウントの0件検索を代用しない |

## 2. 調査の実行手段（本PRで補った部分）

`npm run local:reports:privacy-inventory`はローカルREPORTS_DBの22テーブルを集計し、期限到来/未最小化/skeletonを区別する。
SELECTだけで、値・ID・URL・hash・本文・メールを出力せず、未知テーブルや未適用schemaを正常0件にしない。
`outsideScope`のDATA_DB/提供者/メール/backupと、実ローカルD1で確認した`_cf_METADATA`・migration台帳のエンジン管理メタデータはnot-inspected。内部表名のprefix全体を除外せず、既知の2名だけを区別する。**表単位の点検**であり、列追加・内容/法的根拠の審査を代行しない。
非atomicな読み取りなので、結果は書込み許可/本人証明ではない。全件countはローカル点検用で、Cron/公開APIへ載せない。

既存`local:reports:erasure-impact <reportId>`に0011の独立確認行とDELETE拒否参照を追加。CLIの入力検証をDB接続前へ置き、原例外を出さないよう修正。
どちらもLOCAL ONLY、remote/applyなし。新しい削除機能・削除期限・本人確認の実装とは説明しない。

## 3. 請求別：できる対応と不足

| 請求 | 現機能でできること | できないこと/必要な対応 |
| --- | --- | --- |
| 開示 | 権限ある担当者は既存moderationで原記録を調査可能 | report IDだけで本人へ開示不可。本人との安全な照合・開示範囲/方法を決めるまで顧客向け開示機能として完了扱いしない |
| 申請本文/位置の訂正 | 相談を調査し、誤申請を却下・再確認、必要なら新しい独立情報で審査 | append-only元申請の上書きは不可。これが法的訂正義務に足りるか未決、必要なら別の訂正記録設計 |
| 90日最小化 | 既存保持処理で本文/pin/関連付けとreceipt fingerprintを最小化 | 実運用の実行証拠が必要。ID/監査/認証/履歴/公開factは残る |
| 期限前の削除・完全消去 | 相談対象の参照/影響を読み取り調査できる | 早期/完全eraseと本人確認は未実装。SQLがredactionを許しても、ADR-0021の未決設計を迂回して新CLIを書込み可能にしない。必要な対象・権限・参照整合が決まれば限定実装する |
| 利用停止・非公開相談 | 既存審査/レビュー取り下げ/非公開判断、鍵失効による今後の送信停止 | 鍵失効や却下は保存済みデータの消去ではない。export済み根拠のwithdrawal/再計数/配布先回収は自動対応なし |
| 第三者の個人情報/権利侵害 | 本人確認不能だけで却下せず、運営者が内容を調査し保護措置を検討 | 申請者の権利行使と同一手続きにしない。実消去が必要な保護措置なら限定機能が必要 |
| 再install/端末紛失 | 相談受付と残る対象調査 | 元の鍵を失った人との結び付けは現データだけでは確定できない。私的情報の質問やIDだけで代用しない |

## 4. P0とP1、完了の証拠

### P0：公開前に閉じる

- **保持台帳の実態確認**：本表の全区分について、担当=MannerPath運営を作業基準に、目的・必要期間/終期/見直しの根拠・実保存先・権限・次回確認日を記録する。
  日次の保持/相談確認、90日ごとの必要性見直しを準備用手順とする。これは自動削除期限ではなく、未実施の運用。担当役割はQ3基準から用い、受任/稼働証拠は別に必要。
- **実処理と範囲外**：許可された担当がCron/未実行検知/復旧・容量を検証。提供者設定/Logpush・support mailboxの実態は各権限のある担当へ割当て、確認日時と設定証拠を保存する。無許可の本番操作はしない。
- **請求の履行可能性**：どの対象を誰が何の根拠で開示/訂正/最小化/利用停止できるか、例外/本人確認不能時も含めたケース表を完成する。
  窓口設置や制限説明だけでは閉じない。法的に必要な処理が現機能で不能なら、その範囲の技術設計/実装をP0へ戻す。
- **候補と実装の一致**：90日以外の期限・完全消去等を約束しない。正式文面/残存保持の判断、#394で修正済みのiOS要約と新全文の署名RC照合、Privacy/Support/ASCの一致を最終確認。

### P1：義務や採用した約束に影響しない範囲で後回し

セルフサービス画面、履歴復旧UI、常時通知、2名審査、任意の追加期限の自動化。
必要な請求への唯一の解決策である場合や、採用して公開文面へ約束した期限はP0に戻す。法的義務の延期ではない。

## 5. 技術だけでは確定できない残り（再選択ではない）

Q1〜Q3のAを再度尋ねない。残るのは、**残存識別/監査の保有根拠と必要期間**、**安全な本人確認ができない請求への法的に妥当な扱い**、
**どの開示/消去/訂正を必須とするか**という責任者/必要に応じ専門家の判断。
それ以外のschema調査、件数集計、参照漏れ、エラー秘匿、担当/確認手順は本票とツールで準備した。
実メール設定や実Cronの点検は判断質問ではなく、各担当の実行証拠の残件として扱う。

根拠：`create.ts`/`retention.ts`/`idempotency.ts`、REPORTS_DB migrations0001〜0011、`attest/revocation.ts`、`erasure-impact.ts`、
[ADR-0021 §10/12](../../adr/0021-report-erasure-and-evidence-withdrawal.md)、[既存運用](OPERATIONS.md)、[過去の提供者監査](../../PRODUCTION_PRIVACY_AUDIT.md)。

## ローカル検証（本番の証拠ではない）

- real migrationsを使う対象11テスト：棚卸しのSELECT限定、未知表/旧schema、90日境界、0011参照でのDELETE拒否、CLI引数/診断秘匿を確認。
- 独立worktreeのローカルD1に0001〜0011を適用し、実CLIを実行。reviewed-table-set、未知0、申請0、outsideScopeはnot-inspected、publicationReady/ownershipVerified/writesPerformedはfalse。
- これは空の検証用DBであり、現在の本番保存件数や提供者/メールの確認に転用しない。
