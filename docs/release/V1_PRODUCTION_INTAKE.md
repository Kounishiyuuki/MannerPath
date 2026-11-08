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
- 保持処理の**未承認候補**：`REPORT_RETENTION=cleanup`、5分ごと（UTC `2-57/5 * * * *`）の cron だけ。90日の最小化を実行し、
  未完了・失敗は cron の実行状態とログ（件数のみ）に出る。1日1回最大10件の旧案を改めた生成案で、まだ有効化していない。5分が必要との結論は未確定で、[間隔の採用ゲート](V1_RETENTION_CAPACITY.md#6-最終評価5分間隔を確定しない2026-11-09)を閉じるまでdeployしない。
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
- 保持処理の cron：下の「保持処理の判定」で `stopIntake` になった。
- Workers Free の日次上限（リクエスト 100,000件）や D1 Free の上限に近づいた。

新しい鍵だけを止めるときは、`paused` のまま再デプロイする（既存の鍵は申請できる）。

**保持処理の判定**（`npm run reports:retention-health -- [--covered-since <UTC>] <直近24時間以上の tail.jsonl>` の `action` と `reason`）

`overdue` は、滞留を10件ずつ解消している途中でも出る正常な経過で、Cron の実行状態は失敗（例外）になる。
そのため Cron の失敗件数ではなく、ログの `reportRetention` の結果で区別する。

| `action:reason` | 条件 | 対応 |
| --- | --- | --- |
| `stopIntake:exceededCpu` | 保持 Cron で `exceededCpu`（1102）が1件 | 直ちに受付停止、原因調査 |
| `stopIntake:consecutiveFailures` | 本当の失敗（`failed`、`overdue` の記録なしの例外、不正な記録）が2回連続 | 直ちに受付停止、原因調査 |
| `stopIntake:overdueOverOneDay` | `overdue` を含む未完了が、最後の `complete` から24時間以上続く | 受付停止 |
| `stopIntake:notRunning` | 途切れのない記録（`--covered-since`）で、保持 Cron の実行が24時間以上ないと確認できた | 受付停止、Cron の設定と実行履歴を確認 |
| `investigate:overdueDraining` | `overdue` が2回連続で、残件は減っている（受付は止めない） | 正常な解消の途中か、受付量と処理量を調べる |
| `investigate:overdueNotDraining` | `overdue` が2回連続で、残件が減っていない（受付は止めない） | 容量・失敗の原因を調べる。24時間続けば上の `overdueOverOneDay` で停止 |
| `investigate:cpuOver10ms` | 直近1時間の保持 Cron の半数以上で `cpuTime` が 10 ms 超 | 調査し、確認の頻度を上げる（停止しない） |
| `investigate:failed` / `disabled` / `notRunning` | 失敗1回（後の成功で消えない）、`off`、15分超の空白 | 調べる。次の実行で再判定 |
| `investigate:unconfirmedCoverage` | 24時間以上実行が見えないが、その間の記録が途切れなく続いていたか確認できない | 証拠不足。Workers の Cron 実行履歴（ダッシュボード）で確かめ、未実行が確かなら受付停止 |
| `investigate:invalid` | 不正な時刻・未来の時刻・読めない記録が1件でもある | 正常扱いにしない。記録を取り直して再判定 |
| `watch:overdue` | `overdue` 1回 | 次の実行で残件が減ることを見る |
| `none:healthy` | 最新が `complete` で残件0 | 記録のみ |

- **判定の証拠の範囲**：判定できるのは渡したファイルに入っている分だけ。空のファイルや途中で切れたファイルは、24時間の
  未実行の証拠にならない。`--covered-since <UTC、例 2026-11-08T00:00:00Z>` は、運営者が `wrangler tail --format json` を
  その時刻から再接続の切れ目なく記録し続けたと確認できたときだけ付ける（または Workers の Cron 実行履歴で同じ期間を確認した）。
  ファイルは 4 MiB まで（保持 Cron は1日約288件で、この範囲に収まる）。超えるときは期間を分けず、記録の取り方を見直す。
- 2回連続の本当の失敗は、ファイルのどこにあっても停止になる（後の成功で消えない）。間に `overdue` があれば連続とは数えない。
- 受付の停止は `npm run production:v1-stop`（App ID の削除）だけで行う。**保持 Cron は止めず、`REPORT_RETENTION=cleanup`
  のまま続ける**。受付を止めても滞留の解消は続き、`complete` に戻ることを確認してから再開を判断する。
- 初回24時間は、`wrangler tail --format json` を記録し続け、1時間ごとに上のコマンドで判定する。あわせて Cloudflare の
  Workers Metrics で CPU time と `exceededCpu`、D1 の Metrics で rows read／written を見る。その後は毎日1回。
- 優先順位：`stopIntake` の4条件 → `overdue` 2回連続 → CPU → その他。`overdue` の Cron は実行状態が例外になるため、
  Cron の失敗件数ではなく、この判定で本当の失敗と区別する。
- `production:v1-stop` は App ID を消すだけで、登録済みの鍵の challenge・申請も 503 `attestationUnavailable` になる
  （`test/app-attest-api.test.ts`）。
- 停止後の改善の候補は、1回の件数 10→5、状態確認 3→2回、5→10分間隔の順。いずれも効果と整合性を検証してから変える。

## 4. 手順（`npm run production:v1-plan` が出力する）

各段階の後に `npm run production:v1-check -- --stage <段階>` を実行し、`PASS` だけで次へ進む（§5）。

1. 読み取りで状態を確認し、`--stage before-db`。Lane 2 の migration レビュー（§5）がそろうまで `FAIL`。
2. D1 Time Travel の位置を控える（Free は7日間）。
3. REPORTS_DB 0004〜0011 と DB 0031〜0033 を適用し、`--stage after-db`。
4. peppers を対話で設定し、デプロイし、`--stage after-deploy`。App ID なしなので受付は閉じたまま。
5. 規約が承認されている場合だけ：App ID を設定し、`REPORT_REGISTRATION=enabled` でデプロイし、`--stage after-intake`。

**停止**：`npm run production:v1-stop`（wrangler の確認に答えるだけ）。設定をコミット済みの `wrangler.jsonc` から作り直し、
対象が本番の Worker と DB であることを確かめてから App ID を消す。生成に失敗したら何も消さずに止まる。App ID が既に
ないときは何も消さない（何度実行してもよい）。規約の状態に関係なく動く。最後に `--stage stopped` で fail-closed
（`available:false`、challenge 503 `attestationUnavailable`）を確かめる。

**保持処理の一時停止・Cron の削除**（受付の停止とは別の操作。正常な保持処理は、受付を止めても原則続ける）
- 保持処理だけを一時停止する：Cron（`2-57/5 * * * *`）と `REPORT_RETENTION_CRON` はそのままにして、
  `REPORT_RETENTION=off` でデプロイする。Cron は `disabled` を記録して終わる。
- Cron 自体を削除する：(1) まず `REPORT_RETENTION=off`（Cron 文字列との一致は保ったまま）でデプロイする。
  (2) Cron を削除する（`triggers.crons: []`）。(3) Cloudflare の Cron 設定の反映には最大15分ほどかかるため、
  **少なくとも20分**待ち、Cron の設定（空になったこと）、実行履歴（`disabled` 以外の実行がないこと）、次回予定時刻
  （ダッシュボードの Triggers で表示がないこと）を確かめてから、旧 Worker（`REPORT_RETENTION_CRON` のない版）
  への切替・ロールバックを判断する。
- 保持用の Cron（v1 と写真用）が設定と一致しないとき、Worker は出典確認・R2・DB 書き込みへ進まず、
  `{"event":"scheduled","outcome":"failed","reason":"unexpectedCron"}` を記録して失敗する（`src/scheduled.ts`）。
  出典確認に進むのは許可リスト（`SOURCE_CHECK_CRONS`）の Cron だけ。この修正より前の版には、この防御がない。
- 経緯（2026-11-06 staging）：Cron を外した直後に旧版へ戻したところ、`07:32:26Z` の Cron 1件が旧版で
  `scriptThrewException` になった。旧版に `REPORT_RETENTION_CRON` がなく出典確認へ進み、R2 がないため最初の行で
  止まった、というのが**有力な推定**（ログ本文は権限不足で未確認。時刻・版・コードから推定）。R2 がある本番では
  実際の出典確認が動きうるため、上の順序と防御を設けた。

ロールバック：Worker は、v1 より前の版（2026-10-05 の版は R2 を持ち、`unexpectedCron` の防御がない）へ戻す前に、必ず `production:v1-plan` の rollback の順で、`production:v1-stop` で既存の鍵を含めて受付を止め、`stopped` が PASS でなければ先へ進まない → `retention-off.jsonc` をデプロイ → `no-cron.jsonc` で Cron を削除 → 20分以上待って確認 → 版 ID を指定して `wrangler rollback <version-id>`（ID なしでは直前の v1 の版に戻るだけ）。ロールバック後は `wrangler secret list` で App ID がないことを確認し、復活していた場合は再度削除する。旧版の API は v1 と異なるため、旧版へ戻した後に v1 専用の `--stage stopped` は使わない。
0011 だけを戻すときは `migrations-reports-rollback/0011_new_spot_independent_evidence.sql`。それ以外は D1 Time Travel。

保持の容量・オフラインheartbeat判定・削除相談・残るP0/P1は[最小運用手順](../legal/v1-text-reports/OPERATIONS.md)を参照。新頻度も実Cron/CPU/D1の成功を保証せず、配備・実測は未実施。

## 5. 段階ごとの自動検査（`npm run production:v1-check`）

読み取り専用：`wrangler d1 migrations list`・`wrangler secret list`（名前のみ）・公開ルートの GET。POST（写真の送信、
登録用 challenge）は、受付が閉じているはずの段階で、**App ID がなく `/v1/config` が `available:false` と確かめた後だけ**
送る（閉じた Worker は書き込みの前に拒否する）。受付が開いているように見えれば送らず FAIL にする。`after-intake` は
POST を一切送らない（開いた Worker は challenge を保存しうる）。秘密の値や応答の本文は出力しない。全段階で、
ビルド番号がすべて 8 であること、規約文書の bytes が登録済みの SHA-256 と一致することも確かめる。

結果は `PASS`（終了コード 0）・`FAIL`（1）・`UNVERIFIED`（3：検査は通ったが、読み取りでは示せない項目が残る）。

| 段階 | 確かめること |
| --- | --- |
| `before-db` | **両 DB** の未適用が、想定の一覧（REPORTS_DB 0004〜0011、DB 0031〜0033）と完全に一致。Lane 2 の記録が同じ一覧を1件ずつ承認し、bytes の SHA-256 が一致。未適用なし・記録なしは想定の状態とみなさない。受付は閉じている |
| `after-db` | 両 DB に未適用なし。受付は閉じている |
| `after-deploy` | readiness 200、report schema 3、写真 503 `photoEvidenceDisabled`、規約の版が一致、peppers あり。App ID なし・`available:false` |
| `after-intake` | **規約が草案または公開権利なしなら必ず FAIL**。App ID あり・`available:true`、上記の Worker の項目（写真の POST を除く）。**新しい鍵の登録が開いたことは読み取りでは示せない**（`available:true` は `paused` でも成り立つ）ので、別に承認された canary までは `UNVERIFIED` |
| `stopped` | `after-deploy` と同じ（受付が既存の鍵を含めて閉じている） |

**Lane 2 の migration レビューの取り込み**：`services/api/release/production-migration-review.json` に、未適用の
migration ごとに `{ database, name, sha256, verdict: "approved", reviewedBy }` を Lane 2 の PR で追加する。推測で埋めない。
`sha256` はファイルの bytes の SHA-256（`shasum -a 256 <file>`）。ファイルが1 byte でも変われば `before-db` は FAIL に戻る。
この検査はレビューの内容を判断しない。承認の記録と bytes の一致だけを見る。

2026-11-06 の `--stage before-db`（読み取りのみ）の結果は PR #387 に記録する。Lane 2 の記録が入るまで FAIL のまま。

## 6. 保持Cron導入runbook（別許可の担当者用・本PRでは全て未実行）

冒頭§1の状態は2026-11-05時点の履歴。#410の2026-11-08 GETでは本番Cron空・invocationログ無効・console/error保存有効、Worker Logpush無効/tail0。新しい本番状態を推測しない。
次のコマンド群を一括実行しない。段階ごとの承認/証拠を残し、FAIL/不明なら止める。本PRのmergeはCloudflare操作・規約承認・受付開始許可ではない。

### A. 適用前HOLD（ここまではローカル準備）

1. 実plan/課金・外部出力と既存P0、担当の受任、許容遅れと間隔の判断を記録する。実CPU/D1証拠がない現時点では間隔は未確定。検証環境の配備も別許可とする。
2. 最新mainの承認対象SHAで`make contract`、`make api-validate`、`npm run reports:retention-rehearsal`を確認。生成/テストのmerge以外の自動deploy workflowがないことを再確認する。
3. `services/api`で`npm run production:v1-plan`を実行し、出力を**手順書として読む**。現在の草案ならexit 2/BLOCKEDが期待結果で、表示されたdeployコマンドを続けて実行する許可にはならない。
4. 生成した`.wrangler/production-v1/worker.jsonc`をreview。対象Worker/既存DB IDs・REPORTS_DB分離、写真/R2なし、invocation_logs=false、registration paused、App IDなし、採用後のCron/varsが一致すること。`REPORT_SUBMITTER_PEPPER`/`RATE_LIMIT_KEY_PEPPER`は既存値を保持し、新規必要時のみ別承認で設定。Cron専用secretは不要。

### B. 配備（ここから全て別の本番操作許可が必要）

1. 次の既存preflightを段階ごとに使う。`before-db`は履歴の未適用一覧とレビューを照合するため、既にmigration済み等なら失敗を迂回せず現状に合うレビュー/手順を先に用意する。両DBの復旧bookmarkと戻すWorker versionを私的運用記録へ残す。

```sh
# services/apiから。許可前には実行しない。
npm run production:v1-check -- --stage before-db
# 生成planの承認済みmigration/secret手順が必要な場合だけ実施後：
npm run production:v1-check -- --stage after-db
npx wrangler deploy -c .wrangler/production-v1/worker.jsonc
npm run production:v1-check -- --stage after-deploy
```

2. `after-deploy`のPASSはWorker/readiness/受付停止/写真無効の証拠で、**Cronの配備/実行成功は検証しない**。ダッシュボードの対象Worker Settings/Triggersで採用Cron・vars・版を照合し、反映に最大15分かかり得ることを考慮して実行履歴を確認する。
3. WorkersのCron履歴でscheduledTime/版/実間隔、`reportRetention`のmode=cleanup・outcome・remainingと実失敗を確認。`overdue`は例外表示でも進捗の場合がある。DB/R2/source処理の想定外実行、無効化、missing、未知のログを正常0件としない。
4. Workers MetricsのCPU/1102/失敗、D1 Metricsのread/write/storageを確認。合成localの測定で本番の負荷/保存件数/保持完了を代用しない。許可なく実申請の期限を書き換えたり合成申請を本番投入したりしない。
5. 初日1時間ごと、その後毎日の担当記録へ「環境・Worker SHA・UTC範囲・Cron/vars・complete/overdue/failed・残件・CPU/1102・D1使用量・判断/対応」を保存。生ログ/本文/鍵/IP/私的URLはGit/CI artifactへ置かない。
6. ローカルの`reports:retention-health`は取得済み私的tail JSONLを判定するだけ。途切れのない観測を確認できた場合だけ`--covered-since`を付ける。取得や観測範囲、CPU/D1は別確認する。Dashboardだけの確認をこのCLIのPASSと表現しない。

```sh
# 許可済みの秘匿された観測ファイルのみ。UTCは実際に確認した開始時刻。
npm run reports:retention-health -- --covered-since <UTC> <private-tail.jsonl>
```

### C. 停止・復旧・rollback

- §3の`stopIntake`判定時は、許可された担当が`npm run production:v1-stop`→`stopped` PASSを確認。App ID削除は既存鍵も止める。通常は保持Cronを継続し、受付のみ止める。規約未承認時の単なるregistration pausedは全停止の証拠ではない。
- 保持を外す必要があるrollbackは、生成planの順序を守る：全受付停止/PASS→retention-off版/PASS→no-cron triggers適用→20分以上待ちTriggers空/disabled以外の実行なし/次回なし→stopped PASS→**明示version**へrollback→App ID不在再確認。offは進行中batchの即時キャンセルではない。Cronは版と独立なので古い版へ先に戻さない。
- REPORTS_DBを別DBへ切替えない。Time Travel/DB rollbackは別許可で、受付停止のままschema/receipt full検査と必要最小化を再適用し、復旧確認後に別途再開判断。単純DELETE/secret再作成で復旧を装わない。
- Cronから審査/承認/export/publish/promotionは呼ばない。ローカルリハーサルのcanonical/R2/source tripwireとpending/notQueued不変、対象回帰テストを証拠にする。全処理の再実行安全性と分散排他は別であり、重複呼出しそのもののコストは残る。

導入完了の証拠：採用間隔の判断、承認対象SHA、各preflight、Triggers照合、実行/CPU/D1/復旧・監視記録。いずれか未確認なら受付開始へ進まない。正式規約・受付/個別地点公開の許可は引き続き別。
