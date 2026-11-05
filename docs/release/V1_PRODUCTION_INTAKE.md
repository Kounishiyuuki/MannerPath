# v1.0 (8) 本番の写真なし申請：受付開始の準備・初期運用条件・停止基準（Lane 3 / 2026-11-05）

**この文書と `npm run production:v1-plan` は準備だけ。** 本番 Worker・DB への適用、受付の有効化、費用の発生は
いずれも行っていない。各手順は運営者の承認が必要。

## 1. 本番の現状（2026-11-05、読み取りのみで確認）

| 項目 | 状態 |
| --- | --- |
| Worker `mannerpath-api-production` | 2026-10-05 のバージョン（`/v1/config` は report schema 2、`available:false`）。v1.0 の API ではない |
| Secret | なし（peppers・`REPORT_APP_ATTEST_APP_ID` とも未設定）＝受付は fail-closed |
| REPORTS_DB | 0001〜0003 適用済み。**0004〜0011 が未適用**（0011 だけではない）。申請 0件・鍵 0件 |
| DB（正本） | 0031〜0033 が未適用。公開中のスポット 513件。v1.0 の Worker はこれらを前提にするので、先に別レビューで適用する |
| 規約 | 現行は `report-terms.2026-09-30.draft`（`publicationRights: pending`）。承認済みの版はない（#124 未承認、#383 は候補のみ） |

## 2. 生成される本番設定（`npm run production:v1-plan`）

ネットワークに接続せず、`.wrangler/production-v1/worker.jsonc`（git 管理外）と、順序付きの起動・停止・ロールバック
手順を出力する。値はコードの定数（`scripts/production-v1-plan.ts` の `V1_PRODUCTION`）で、変更はレビュー済みの PR で行う。

- 正本・申請 DB は、コミット済みの本番 ID のまま。**R2 のバインディングなし**、写真の設定なし。
- App Attest：`production`、bundle version `8`。`REPORT_APP_ATTEST_APP_ID` はファイルに書かず Secret にする
  （消せば、デプロイなしで既存の鍵を含めて受付が止まる）。
- 登録の上限：**5件/時・20件/日**（staging の半分）。申請の上限は 10件/時・50件/日（D1 トリガー、変更なし）。
- `CHALLENGE_RATE_LIMITER`：namespace `9802`・60件/60秒（staging は 9801）。
- 保持処理：`REPORT_RETENTION=cleanup`、毎日 03:17 JST（`17 18 * * *`）の cron だけ。90日の最小化を実行し、
  未完了・失敗は cron の実行状態とログ（件数のみ）に出る。
- **規約のゲート**：現行の規約が草案、または公開権利が `granted` でない間は、App ID の設定と登録の開放を出力せず
  `BLOCKED` を表示して終了コード 2 を返す。草案への過去の同意は、どの版の承認でも公開権利にならない
  （`src/reports/terms.ts`、`test/production-v1-plan.test.ts`）。

規約の承認後は、`src/reports/community-publication.ts` の決定（新しい版・最終文書のパス・SHA-256）を別 PR にする
（`docs/legal/COMMUNITY_PUBLICATION_DECISION.md`）。版と hash は最終 bytes から生成する。

## 3. 無料枠での初期運用条件と停止基準

CPU の余裕と `CHALLENGE_RATE_LIMITER` の 429 は**未検証**（staging の E2E：`cpuTime` 最大 10 ms、1102 は0件、
ただし55件だけ。429 は一度も観測していない）。このため、受付開始は次の条件に限る。

**初期条件**
- 登録の上限 5件/時・20件/日。Workers Paid・R2・有料の WAF ルールは使わない。
- 受付開始は運営者が24時間内に確認できる日に行う。最初の7日は毎日確認する。
- 審査は運営者1名で、独立確認（公式情報源または現地確認）の記録なしには承認・export できない（0011）。

**毎日見るもの**（Cloudflare ダッシュボード Workers Metrics、または `wrangler tail` の集計）
- `outcome` 別の件数（`exceededCpu`＝1102）、CPU time の P50／P99、HTTP 429 と 5xx の件数。
- 保持処理の cron の成否、申請と登録の件数。

**停止基準**（1つでも当たれば、`npx wrangler secret delete REPORT_APP_ATTEST_APP_ID` で既存の鍵を含めて止める）
- `exceededCpu`（1102）が申請・challenge・鍵登録のルートで1件でも出た。
- 申請系のルートで CPU 10 ms 超が5%を超えた、または 5xx が続けて出た。
- 同じ下書きの二重保存、規約の版の不一致、写真のルートが 503 以外を返した。
- 1日の登録が上限（20件）に達した日が続く、または同じ IP からの大量の challenge（429 が出ないままの急増）。
- 保持処理の cron が失敗した、または `overdue` が2日続いた。
- Workers Free の日次上限（リクエスト 100,000件）や D1 Free の上限に近づいた。

新しい鍵だけを止めるときは、`paused` のまま再デプロイする（既存の鍵は申請できる）。

## 4. 手順（`npm run production:v1-plan` が出力する）

各段階の後に `npm run production:v1-check -- --stage <段階>` を実行し、`PASS` だけで次へ進む（§5）。

1. 読み取りで状態を確認し、`--stage before-db`。Lane 2 の migration レビュー（§5）がそろうまで `FAIL`。
2. D1 Time Travel の位置を控える（Free は7日間）。
3. REPORTS_DB 0004〜0011 と DB 0031〜0033 を適用し、`--stage after-db`。
4. peppers を対話で設定し、デプロイし、`--stage after-deploy`。App ID なしなので受付は閉じたまま。
5. 規約が承認されている場合だけ：App ID を設定し、`REPORT_REGISTRATION=enabled` でデプロイし、`--stage after-intake`。

**停止**：`npm run production:v1-stop`（wrangler の確認に答えるだけ）。App ID を消し、既存の鍵を含めて受付を止め、
続けて `--stage stopped` で fail-closed（`available:false`、challenge 503 `attestationUnavailable`）を確かめる。

ロールバック：Worker は `wrangler rollback`。その後 `--stage stopped` を実行し、App ID が戻っていないかを確かめる。
0011 だけを戻すときは `migrations-reports-rollback/0011_new_spot_independent_evidence.sql`。それ以外は D1 Time Travel。

## 5. 段階ごとの自動検査（`npm run production:v1-check`）

読み取り専用：`wrangler d1 migrations list`・`wrangler secret list`（名前のみ）・公開ルートの GET と、書き込みの前に
拒否される POST（写真の送信、登録用 challenge）だけ。秘密の値や応答の本文は出力しない。全段階で、ビルド番号が
すべて 8 であること、規約文書の bytes が登録済みの SHA-256 と一致することも確かめる。

| 段階 | 確かめること |
| --- | --- |
| `before-db` | REPORTS_DB の未適用が 0004〜0011 だけ。未適用の各 migration を Lane 2 が承認済み（下記）。受付は閉じている |
| `after-db` | 両 DB に未適用なし。受付は閉じている |
| `after-deploy` | readiness 200、report schema 3、写真 503 `photoEvidenceDisabled`、規約の版が一致、peppers あり。App ID なし・`available:false` |
| `after-intake` | **規約が草案または公開権利なしなら必ず FAIL**。App ID あり・`available:true`、上記の Worker の項目 |
| `stopped` | `after-deploy` と同じ（受付が既存の鍵を含めて閉じている） |

**Lane 2 の migration レビューの取り込み**：`services/api/release/production-migration-review.json` に、未適用の
migration ごとに `{ database, name, sha256, verdict: "approved", reviewedBy }` を Lane 2 の PR で追加する。
`sha256` はファイルの bytes の SHA-256（`shasum -a 256 <file>`）。ファイルが1 byte でも変われば `before-db` は FAIL に戻る。
この検査はレビューの内容を判断しない。承認の記録と bytes の一致だけを見る。

2026-11-05 の `--stage before-db`：ビルド 8・規約 hash・受付が閉じていることは PASS、未適用の 11件がレビュー未登録で FAIL。
