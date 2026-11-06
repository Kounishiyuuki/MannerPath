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

**書き込み**：1回 最大30行（10件の最小化 + 10件の receipt + 期限切れの枠・challenge）。最大 288 × 30 = 8,640行/日で、
D1 Free の 10万行/日の 8.6%（滞留がある日だけ）。round trip は1回 7〜8（Free の1回 50 subrequest の範囲内）。

## 3. CPU（10 ms）について

ローカルの JS の CPU（Node の `process.cpuUsage`、miniflare への RPC の直列化を含み、D1 側の時間は含まない）は1回 3〜18 ms。
最初の1回が大きく、ばらつきがある。**workerd での CPU は測っていない**ので、10 ms 以内とは判定しない。

処理の大部分は D1 の待ち時間（CPU に数えない）で、JS の処理は1回 最大27文の bind と結果の整形。
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
