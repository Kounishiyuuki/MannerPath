# v1.0 5分間隔の90日最小化：Workers Free での容量（Lane 3 / 2026-11-06）

**本番・staging の変更はなし。** 測定は隔離したローカル D1（miniflare、一時ディレクトリ、合成データのみ、終了時に削除）。
実 Cron・workerd の CPU・D1 本番の課金カウンタは未測定（§4 の計画で staging 測定する）。

## 1. 見つかった問題（修正前の main `a3b6ffa`）

5分ごとの cleanup（`2-57/5 * * * *`、288回/日）は、1回ごとに `retentionStatus` を3回実行する（`validate`・処理前・処理後）。
その `inconsistentReceipts` は `report_idempotency` を**全件走査**する（`EXPLAIN QUERY PLAN`：`SCAN i`）。receipt は
削除されない（0004 `report_idempotency_no_delete`）ので、**読み取り行数は保存された全申請数に比例して増え続ける**。

`npm run reports:retention-capacity`（下記 §3）での実測（D1 の `meta.rows_read`、何もしない状態の1回 × 288）：

| 条件 | 1回の読み取り行 | 1日（288回） | D1 Free 500万行/日 に対して |
| --- | ---: | ---: | ---: |
| 履歴 3,000件・新規なし | 18,161 | 523万 | **104.6%** |
| 1日50件の受付（直近97日分）・履歴 0 | 29,261 | 843万 | **168.5%** |
| 1日50件・履歴 3,000件 | 47,261 | 1,361万 | **272.2%** |

これだけで Free の日次の読み取り上限を超え、API の読み取り（タイル・設定・申請）と合わせて D1 が止まる。

## 2. 修正（このPR）

cleanup（Cron）の receipt 確認を、1回の処理が触れうる行だけにした（`ReceiptScope = "pass"`）。どちらも索引の範囲検索：
- 期限を過ぎてまだ最小化していない申請（部分索引 `reports_minimize_due`、`minimize_after <= now`）。
- 90日の期限が直近7日以内に来て、最小化済みの申請（`reports_received_page`、`received_at` の上下限）。

それより古い receipt は1回の処理では壊れない。最小化した申請は二度と変わらず（`reports_only_redaction_updates`）、
receipt は1回の retire しかできず削除もできない（0004 のトリガー）。古い複製からの復元などで外側がずれた場合は、
`monitor`（運営者がその場で見る）の `full` の確認でしか見えない。**復元・ロールバックの後は受付を閉じたまま
`full` の確認を行う**（既存の手順のとおり）。migration・索引の追加はなし。

修正後の実測：

| 条件 | 1回目（23件の滞留） | 何もしない1回 | 1日（288回） | D1 Free に対して |
| --- | ---: | ---: | ---: | ---: |
| 1日10件・履歴 0／3,000件 | 870 | 647 | 18.6万 | 3.7% |
| 1日50件・履歴 0／3,000件 | 2,790 | 2,567 | 73.9万 | 14.8% |
| 新規なし・履歴 0〜10,000件 | 380 | 164 | 4.7万 | 0.9% |

読み取りは「滞留 + 直近7日の受付」に比例し、履歴には比例しない。どの条件でも 23件の滞留は3回で解消し
（`overdue, overdue, complete`）、その後の再実行は何も変えない。最後の `full` の確認で receipt の不整合は0件。

**書き込み**：本体行は1回最大40行（申請10 + receipt10 + 期限切れ枠10 + challenge10）。288 × 40 = 11,520行/日は本体行の名目計算で、索引更新を含むD1課金値の上限保証ではない。
D1 Free枠の判定は実際のmeta/metricsで行う（この訂正は処理件数を変更しない）。round trip は1回 7〜8（Free の1回 50 subrequest の範囲内）。

## 3. CPU（10 ms）について

ローカルの JS の CPU（Node の `process.cpuUsage`、miniflare への RPC の直列化を含み、D1 側の時間は含まない）は1回 3〜18 ms。
最初の1回が大きく、ばらつきがある。**workerd での CPU は測っていない**ので、10 ms 以内とは判定しない。

処理の大部分は D1 の待ち時間（CPU に数えない）で、JS の処理は1回 最大40更新文の bind と、範囲を限定した読み取り・結果の整形（件数は写真なしcleanupの場合）。
超えるおそれがある場合の改善案（無料のまま）：
1. 1回の件数を 10 → 5 に下げる（`applyReportRetention` の `limit`）。処理能力は 1,440件/日に下がるが、1日50件の受付には十分。
2. 1回の `retentionStatus` を3回 → 2回にする（`validate` の確認を処理前の確認と兼ねる）。
3. 間隔を 5分 → 10分にする（144回/日。読み取りも半分）。

`exceededCpu`（1102）が Cron で1件でも出たら、1 → 2 → 3 の順に適用する。

## 4. staging での Cron 実測の計画（未実施・承認が必要）

新しいデプロイを伴うため、このPRでは行わない。
1. `staging:v1-config` の出力に `REPORT_RETENTION=cleanup`、`REPORT_RETENTION_CRON` と `triggers.crons` を
   `2-57/5 * * * *` にした設定でデプロイする（受付は `paused` のまま）。staging の合成申請2件と、運営ツールで作る
   合成の申請だけを使う。
2. `wrangler tail --format json` を2時間（24回）流す。
3. `npm run reports:retention-health -- tail.jsonl` で、各回の結果が `complete` か、`missing`・`stale` がないかを見る。
4. 同じ tail で、Cron の各回の `cpuTime` と `outcome`（`exceededCpu` の件数）を集計する。
5. Cloudflare ダッシュボードの D1 の Metrics で、その2時間の rows read／written を見て、§2 の予測と比べる。
6. 終わったら cron なしの設定で再デプロイする。

判定：`exceededCpu` 0件、`cpuTime` の最大が 10 ms 未満、rows read が予測の2倍以内。満たさなければ §3 の改善を行う。

## 5. 配備準備のローカルD1リハーサル（本番変更なし）

`npm run reports:retention-rehearsal`は、入力引数/remote/任意config/既存DBを受け付けず、一時local D1へ実migrationを適用して合成申請23件を作る。
実際の`dispatchScheduled`を呼び、期限前非消去、receipt更新途中のSQL失敗によるbatch rollback、同じ行を選んだ2回の重複実行、proxy再起動後の再実行、残件13→3→0とreceipt整合性、実行途中に後続invocationをoffにした場合のDB非アクセスと、既に選択済みのbatchの安全な完了を検証する。最後に一時DBを削除する。
DB/R2/source dispatcherはtripwireでアクセスを拒否する。公開513地点の実データを読み込まず、本番の現件数/データ同一性を再監査したとはしない。
`pending/notQueued`が保持後も変わらないことを確認し、承認/公開は実行しない。runtime・同意・source/公開ゲートの変更はない。

このリハーサルのscheduled関数はNodeから実行し、DBはlocal workerd/miniflare。**Workers isolateのCPU測定、実Cron/実D1同時実行の保証ではない**。
重複時は原子的更新/条件付き退役で復活を防ぐが、排他leaseは追加しない。二重読取り/実行自体を防ぐものではなく、設定は1系統、手動cleanupを重ねない。
失敗診断は固定phaseだけを出し、SQL例外/本文を出力しない。ローカルworkerdを起動できる環境で実行する。

2026-11-08の実行結果：**PASS**。合成23件、failureRollback / overlappingSelections / restartAndRetry / stopDuringRun / moderationUnchangedはすべてtrue、canonicalAccesses/sourceCallsは0。`productionVerified`と`workersCpuMeasured`はfalse。起動権限が制限されたsandboxではlocal proxyのopenに失敗したため、ローカルworkerd起動を許可した隔離実行で確認した。

### 本番に適用する差分と配備ゲート（未適用）

| 項目 | 準備済み差分/確認方法 |
| --- | --- |
| 設定案 | 既存`production:v1-plan`が生成するworker.jsonc。`REPORT_RETENTION=cleanup`、`REPORT_RETENTION_CRON=2-57/5 * * * *`、triggersにも同じ1件。本番GETで空だったCronを有効にする差分なので、別許可までdeployしない |
| 5分間隔の根拠 | 288枠/日×申請10件=名目2,880件/日。1日1枠の10件では1鍵の50件/日にも追いつかない。§2の索引範囲の既存測定は5分案を支持するが、複数鍵の総流入・実CPU・quota余裕は未保証。間隔を短縮する前に実負荷で再判断 |
| 必要なsecret | 申請用の既存`REPORT_SUBMITTER_PEPPER`、`RATE_LIMIT_KEY_PEPPER`。`REPORT_APP_ATTEST_APP_ID`は受付を閉じて保持を確認する段階では追加しない。Cron専用secretは不要。値の生成/設定/削除は今回行わず、存在確認は名前だけ。既存pepperを作り直すと関連付けが変わるため置換しない |
| 保持開始前 | REPORTS_DB binding/schema/receipt、復旧bookmark、migrationレビュー、停止手順を確認。正式規約未承認によるplanのBLOCKEDは正常であり、受付許可ではない。写真/R2/source用Cronを追加しない |
| 配備後/受付前 | 別許可の担当が実vars/Triggers/版を確認。実Cronのcleanup集計、失敗復旧、CPU/1102・D1 rows/read/write、24時間分の観測を確認。実plan/account出力/Gmailは未確認のまま。本番の5分間隔・CPUをローカルPASSで代用しない |
| 停止 | 通常は`production:v1-stop`で全受付を止め、健全な保持は継続。offは後続実行を止める設定で、進行中batchを即時キャンセルしない。registration pausedだけでは既存鍵を止めない。実失敗2回/1102は既存監視の停止判定を使い、bounded overdueは別扱い |
| rollback | 既存planの順序：全受付停止/PASS→retention-off版/PASS→no-cron適用→20分以上待ってTriggers空・disabled以外の実行なし・次回なしを確認→PASS→明示versionへrollback→App ID不在再確認。復元後は受付を閉じたままfull検査/必要最小化。復旧履歴を物理消去としない |

生成plan・既存`production-v1-check`・`production-v1-stop`と対象テストを再利用する。本資料は公開許可や設定適用ではない。

公式仕様の再確認（2026-11-08）：[Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)のUTC/反映遅延、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)のトランザクションと失敗時rollbackを参照。再実行安全性と排他は別である。
