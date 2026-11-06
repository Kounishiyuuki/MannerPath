# v1.0 (8) 本番migration：Lane 2独立技術レビュー承認記録

判定日：2026-11-06。担当：Lane 2 / Codex（Lane 3の実装・適用手順から独立した技術レビュー）。
確認main：`504ce4aba3163bf19ea0b1026d3d13c4e9323f7d`（作業中に#387が統合されたため追従。開始時は#386の`f6c3ba2`）。
機械可読記録：[`services/api/release/production-migration-review.json`](../../services/api/release/production-migration-review.json)。

**承認11件・保留0件・却下0件。** 各ファイルの内容・既存状態への影響・復旧方法を個別に判断した。
承認はJSONに記載したdatabase・ファイル名・SHA-256の組に限る。新しいmigration、別DB、1バイトでも異なるSQLには及ばない。
この記録は技術的な安全性レビューであり、本番書き込み・migration実行・Worker deploy・受付開始・料金発生の許可ではない。
本番実行は別の運営者判断であり、#387のチェックが自動生成・追加・推測する承認でもない。

## 1. 判断の根拠と時点

前回監査main `4d59b24fdd7b1dfc4deeee9e7e823014a1823791`で、2026-11-05 UTCに本番の読み取りと隔離ローカル再現を実施した。
今回のmainで対象11件のSHA-256を再計算し、前回監査の全ファイルと一致することを確認した。#386によるSQL変更はない。
以下は前回の観測であり、現在の本番状態を改めて取得したという意味ではない。適用直前の再確認は省略できない。

| 項目 | 観測・比較結果 |
|---|---|
| 正本DB | ledger 0001〜0030、513地点、approvedな6ソース、外部キー違反0、quick_check正常 |
| REPORTS_DB | ledger 0001〜0003、申請0・App Attest鍵0・写真0、外部キー違反0、quick_check正常 |
| 正本の実export | privateなローカルSQLiteへ復元。適用前schemaはリポジトリ0030と一致、適用後は最新schemaと一致（SQLコメント・整形差を除く） |
| 既存データ | ledgerを除く既存71表の元の全列・全行を正規化・ソートしたSHA-256が適用前後で一致 |
| 権利・出典 | sources 6、source_releases 6、source_records 2,532、spot_field_provenance 2,456行が不変。承認・license・attribution・未知値を変更しない |
| タイル | snapshots 81、parts 81、membership 513行の本文・revision・SHAが不変。再生成なし |
| ローカルの最新Worker読取 | 513詳細の表示用spot DTOが既存タイルと一致。81manifest・81partsの本文とETag、81legacy本文、81件の304応答を確認 |
| REPORTSの最小化した照合 | 本番DDL・件数・履歴を読み取り照合。運用identity等の実行データはexportせず、ローカルで合成metadata・申請・鍵・challengeを用いて再現 |
| 適用後の整合性 | canonical、REPORTSともローカルforeign_key_check違反0。正本integrity_check正常 |

実exportのSHA-256、表ごとの行ハッシュ、11件のSQLハッシュは監査時にローカルへ保存した。生のSQL export・DB・申請・鍵・
運用identity・一時署名URLはこのPRに含めない。D1 exportは読み取りであっても、他queryを一時的にブロックし得る。
ローカルAPI確認は表示用データの検証であり、iPhone画面や実機の検証を代替しない。

REPORTS_DB全体exportは自動承認レビューで、schema・運用metadataを含む全体持ち出しの承認範囲が不明として却下された。
全体exportを別経路で取得せず、許可されたDDL・件数照合と合成データ再現へ限定した。このため本番運用metadataの実値を
丸ごと複製して比較したとは扱わない。SQL自体に既存metadata・申請・鍵を更新する文がないことも独立に確認した。

## 2. ファイル別の独立判断

各行の正確なSHA-256は機械可読記録を正本とする。`approved`は下記の理由と§3〜§4の条件を伴う。

| DB / migration | 判断 | 内容・既存データへの影響 | 復旧に関する判断 |
|---|---|---|---|
| DB / 0031_derived_coordinate_evidence_guards.sql | approved | 派生座標証拠のREPLACE、承認boolean、不十分な現地根拠をINSERT時に拒否する4ガード。既存行・掲載・権利を変更せず、派生座標の公開を有効にしない | down SQLなし。追加ガードを保持した旧Worker運用を優先。必要なschema復元はDB全体とWorkerを整合させる |
| DB / 0032_location_precision_v2.sql | approved | area anchorへnullableな3列とINSERTガードを追加。既存列は変更せず、新列はNULL。旧v1の位置精度を維持し、既存地点を近似／正確へ再分類しない | 列の手動削除で戻さない。最新Workerが新列を参照するため、DBだけ旧schemaへ戻さない |
| DB / 0033_spot_evidence_holds.sql | approved | 空のhold監査表・ガードとpromotion空DBガードを追加。holdを挿入せず、source healthのtimeout/403だけで自動非公開化しない。513地点・81タイルの変更なし | down SQLなし。監査表の削除をrollbackに使わない。復元時はWorkerとの整合と復元後に失う変更を評価 |
| REPORTS_DB / 0004_report_idempotency.sql | approved | receipt・hard budgetを追加。既存申請を上書き・backfillせず、旧申請に冪等キーや権利を付与しない。新規受付の二重保存・上限超過をDBでも防ぐ | forward-only。receipt・budget表を削除せず、受付停止と互換Workerへの戻しを優先 |
| REPORTS_DB / 0005_app_attest_key_revocation.sql | approved | 失効表とcounter/challengeのフェンスを追加。既存鍵・challenge・counterを変更しない | forward-only。失効履歴を消すrollbackは禁止。旧Workerへ戻す場合もDB側フェンスを保持 |
| REPORTS_DB / 0006_bulk_report_rejection.sql | approved | 新しいbulk identity・不変audit・対象表・ガードを追加。既存store identityや申請を変更しない。新bulk identityの初期化1行は意図した追加 | audit表やidentityを削除して戻さない。実際の却下は別の明示操作であり、migration自体は却下を行わない |
| REPORTS_DB / 0007_photo_deletion_attempts.sql | approved | 削除試行の件数・時刻だけを別表に追加。既存削除キュー2列の形を保ち、写真本文・鍵をコピーしない。R2を有効化しない | forward-only。旧コードは新表を使わず動作可能。削除キューそのものを削除しない |
| REPORTS_DB / 0008_admin_review_audit.sql | approved | 運営レビューの不変metadata表・ガードを追加。本文・pin・投稿者情報をコピーせず、既存審査状態を変更しない | forward-only。auditの削除・書換えをrollbackにしない |
| REPORTS_DB / 0009_new_spot_photo_gate.sql | approved | 新規地点exportに承認済み写真を要求するガードを追加。既存申請・承認・公開地点を変更しない。0011へ至る中間段階で条件が厳しくなることは安全側 | 番号順を省略しない。後続0010/0011と整合させる。途中状態で受付や新Workerを開かない |
| REPORTS_DB / 0010_new_spot_photo_erasure_window.sql | approved | 写真の削除予定・削除キュー・24時間の閲覧余裕をexport条件へ追加。既存写真や申請を更新しない | 0011 rollbackが復元すべき厳しい写真ゲート。旧ゲートの実SQLとの一致を確認済み |
| REPORTS_DB / 0011_new_spot_independent_evidence.sql | approved | 独立確認の不変記録と、閲覧可能な承認済み写真 OR 運営者確認のexport条件を追加。記録だけでは承認されず、期限・redaction・審査・権利・公開手続きは残る | 専用rollbackが0009/0010の元ゲートを復元し、確認記録は保持。再有効化は新migrationで行い、0011を再実行しない |

## 3. 適用順序と承認の成立条件

1. 別途許可された適用担当が、対象の本番DB binding、適用済み履歴・schema、未適用一覧、SQLのSHA、受付停止状態を再確認する。
   観測したprefixは正本0030・REPORTS0003。履歴の抜け・部分適用・未知のファイル・異なるSHA・unexpectedな状態は、この記録だけで正当化しない。
   途中状態は#387のbefore-db PASS対象ではない。失敗時は完了分のledger・schema・FKを読み、復旧を独立に判断する。チェックを緩和して再開せず、空のpendingだけで履歴正常を推測しない。
2. 適用直前の復元点／exportを確保する。今回の過去snapshotだけで現在の復元点を代用しない。
3. 各streamで番号順に適用する。推奨はREPORTS0004→…→0011、続いて正本0031→0032→0033。
   2つのDBにまたがる一括transactionはない。順序を前後させて旧ガードを飛ばさない。
4. 全対象のledger・schema・FK・既存件数・タイル／詳細読取の整合性を確認するまで、受付・運営審査／export・正本更新を停止して扱う。
   新Workerの導入は全schema前提が満たされた後の別操作であり、この承認記録では許可しない。
5. 規約・公開権利・実機E2E・監視・受付開始の判断は別のゲートに残す。既存513地点の不変性は、草案同意の投稿へ権利を付与する根拠ではない。

## 4. 途中失敗と復元

D1の原子性はmigrationファイル単位。失敗した1ファイルはrollbackされるが、先行して成功したファイルは残る。
11件をまとめて自動undoできるとは扱わない。失敗時は受付停止を維持し、実際のledger・schemaを読んでから次の処置を判断する。
手動のtable/column削除、ledger改変、成功済みSQLの再実行による帳尻合わせは行わない。

正本0031〜0033、REPORTS0004〜0008にはdown migrationがない。可能なら追加schemaを残して互換性のある旧Workerへ戻す。
0011だけには`migrations-reports-rollback/0011_new_spot_independent_evidence.sql`があり、ローカルで写真専用ゲートの復元と
確認記録の保持を検証した。これは独立確認だけのexportを再び拒否するもので、既に公開したデータを撤回する操作ではない。

Time TravelはFreeで7日分。復元はDB全体を上書きし、進行中queryを停止する。bookmark後の申請・審査・鍵・失効などを失い得るので、
受付開始後のREPORTS_DB復元を無損失のundoとは扱わない。正本だけ古いschemaへ戻して最新Workerを残すと、新列・hold表の参照が失敗する。
Workerを戻すと過去のSecret状態が復元され得る点も別に検証する。今回、本番の適用・復元・Worker rollbackは実行していない。

公式根拠：
[D1 migrations apply](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply)、
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、
[trigger内CASE/ENDを巡る既知のsplit問題](https://github.com/cloudflare/workers-sdk/issues/4727)。
対象のREPORTS0004〜0011は現Wranglerで計50文へ分割して再現済み。過去の0003復旧問題を、未確認の後続migrationへ一般化しない。

## 5. 検証の成功と制約

前回の重点153テスト、契約検証、型チェック、実exportを使った適用前後照合は成功した。
全API実行は1,440/1,441成功で、既存bulk CLIの子プロセスが30秒で終了（status143）した1件が失敗。
同じCLIテストは単独で成功し、専用ローカルD1へのmigration・dry-run・原子的処理・再実行を確認した。
discoveryは別実行で102件成功。全APIの元の実行を成功に言い換えない。SQL不具合の証拠は確認されなかった。
GitHub CIはbilling lockによってジョブ未起動であり、成功と記録しない。追加料金で回避する操作は行わない。

今回のPRでは、承認集合が11件だけであること・重複がないこと・各SHAが実ファイルと一致することをローカルテストで検証する。
テストは新しい承認を生成せず、実migrationを変更しない。承認内容の根拠は§1〜§4の実内容レビューと復旧評価にある。

## 6. #387との所有範囲

Lane 2はJSON承認記録・この資料・記録の整合性テストを所有する。Lane 3はpreflight・remote取得・stop処理を所有する。
`database/name/sha256/verdict/reviewedBy`の既存キーを維持し、reviewedByは`lane2`とする。
#387は作業中にmainへ統合された。このPRは最新mainの空placeholderを承認記録へ置き換え、旧「実記録は空」assertを除く後続PRとする。
実ファイルの集合・SHAを別テストで検証し、空・欠落・変更バイト・重複・却下はfixtureでfail-closedを検証する。実記録を消したり空へ戻したりしない。
この構成では未統合PR間のadd/add競合がなく、Gate/stopの実装は変更しない。本番preflight自体も実行しない。
