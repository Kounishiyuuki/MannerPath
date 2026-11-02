# v1.0 写真なし新規地点：staging 準備・実機E2E・本番チェックリスト（Lane 3 / 2026-11-03）

Status: **手順のみ。staging の作成・変更・デプロイは一切実行していない。** 共通の前提（B1〜B4、0003 の取り込み、
Secret の扱い）は [STAGING_VERIFICATION.md](../STAGING_VERIFICATION.md)。ここでは v1.0 の写真なし申請に固有の部分だけを書く。
仕様は [V1_PHOTO_FREE_NEW_SPOT.md](V1_PHOTO_FREE_NEW_SPOT.md)。

## 1. 現状（2026-11-03、読み取りのみで確認）

| 項目 | 状態 |
| --- | --- |
| 構成 | `wrangler.jsonc` の `env.staging`：Worker `mannerpath-api-staging`、D1 `mannerpath-staging`／`mannerpath-staging-reports`（本番の `mannerpath-production*` と別名）、`REPORT_ATTESTATION=required`、`REPORT_REGISTRATION=paused`、cron なし |
| リソース | **staging の D1 は未作成**（`wrangler d1 list` にない）。ID はプレースホルダー（`test/deploy-config.test.ts` が要求） |
| App Attest | `REPORT_APP_ATTEST_APP_ID`・`_ENVIRONMENT`・`_BUNDLE_VERSIONS`・`REPORT_SUBMITTER_PEPPER` は未設定。この状態の `POST /v1/reports` は 503 `attestationUnavailable`（fail closed） |
| challenge の rate limit | `CHALLENGE_RATE_LIMITER` は未設定（B2）。staging 専用の namespace としきい値を運営者が決める |
| 写真 | R2 写真バインディング・`PHOTO_EVIDENCE` は設定しない。`REVIEWED_PHOTO_TERMS` が空なので写真ルートは常に 503 |

## 2. 設定の整理（staging で必要な値）

| 種類 | 名前 | staging の値 | 備考 |
| --- | --- | --- | --- |
| var | `REPORT_ATTESTATION` | `required` | 既存。`disabled` に変えない |
| var | `REPORT_APP_ATTEST_ENVIRONMENT` | 実機ビルドの実際の App Attest 環境（TestFlight／App Store 配布は `production`、Xcode の Debug は `development`） | 環境が違う鍵は `environmentMismatch` で拒否 |
| var | `REPORT_APP_ATTEST_APP_ID` | `<Team ID>.<staging の bundle ID>` | 本番と同じでもよいが、staging 向けクライアントでだけ使う |
| var | `REPORT_APP_ATTEST_BUNDLE_VERSIONS` | E2E に使うビルド番号だけ | 古いビルドは拒否される |
| var | `REPORT_REGISTRATION` | E2E の間だけ `open`、終わったら `paused` | `paused` は新しい鍵の登録だけを止める。既存の鍵からの申請は止まらない |
| var | `REPORT_REGISTRATION_MAX_PER_HOUR`／`_DAY` | 運営者が決める（B2） | |
| Secret | `REPORT_SUBMITTER_PEPPER`・`RATE_LIMIT_KEY_PEPPER` | staging 専用の新しい値（32文字以上） | 本番と共有しない。表示・ログ出力しない |
| binding | `CHALLENGE_RATE_LIMITER` | staging 専用 namespace | B2 |
| 規約 | `reports.termsVersion` | `/v1/config` が返す `CURRENT_REPORT_TERMS.version` | クライアントは古い版で送ると 409 `termsVersionOutdated` |
| 受付 | `reports.available` | 上の値が揃い、REPORTS_DB があるときだけ `true` | `photoEvidenceEnabled` は常に `false` |

## 3. staging に 0011 を当てる手順（未実施・運営者の承認が必要）

1. `npx wrangler whoami` でアカウントを確認する。`wrangler.jsonc` の staging の ID が本番と違うことを
   `test/deploy-config.test.ts` と目視で確認する。
2. 新しい REPORTS_DB に 0001／0002 → 0003 のガード付き取り込み → 0004〜0010 を当てる（STAGING_VERIFICATION.md の手順）。
3. 当てる前の状態を記録する：
   `npx wrangler d1 migrations list REPORTS_DB --env staging --remote`（未適用に 0011 だけがあること）。
4. `npx wrangler d1 migrations apply REPORTS_DB --env staging --remote`。
5. 読み取りで確認する：
   ```sql
   SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'report_reviews_new_spot%';
   -- 期待：report_reviews_new_spot_evidence の1行だけ（0009/0010 のトリガーは消えている）
   SELECT sql FROM sqlite_master WHERE name='new_spot_evidence_checks';  -- place_confirmed 列があること
   SELECT count(*) FROM new_spot_evidence_checks;                         -- 0
   ```
6. 戻す場合：`npx wrangler d1 execute REPORTS_DB --env staging --remote --file migrations-reports-rollback/0011_new_spot_independent_evidence.sql`
   のあと、手順5のトリガーが `report_reviews_new_spot_photo_evidence`／`_viewable` の2つになったことを確認する。
   REPORTS_DB 自体の削除・作り直しはしない。

## 4. 実機E2Eシナリオ（staging、Release build、合成データのみ）

前提：staging 向けの Release build（staging API の origin、§2 の App ID・ビルド番号）。地図上のピンは公共の場所の
合成データにし、メモには「E2E テスト」と書く。実在の人物・車両番号・個人の写真は使わない。端末の位置情報の
許可は、テスト中だけにする。

| # | 操作 | 期待される結果 | 確認の方法 |
| --- | --- | --- | --- |
| 1 | `/v1/config` を取得 | `reports.available:true`・`photoEvidenceEnabled:false`・`termsVersion` が現行 | アプリの表示、または `curl` |
| 2 | 初回の送信（鍵の登録→challenge→申請） | 201。アプリに「運営が確認してから掲載を判断します（自動では掲載されません）」の趣旨。写真の入力欄は出ない | アプリ、運営ツールで `pending` |
| 3 | 通信を切って送信→戻して再送 | 2回目は新しい challenge で送られ、200 で同じ reportId。申請は1件 | 運営ツールの件数 |
| 4 | 送信内容を変えて同じ下書きを再送 | 409 `idempotencyConflict`、アプリは新しい下書きを求める | アプリ |
| 5 | 日本の範囲外のピン（シミュレーター／位置の偽装はしない。アプリの事前チェックをテストビルドで外す場合のみ） | アプリが送信前に止める。サーバーは 400 `outside_service_area` | アプリ、tail |
| 6 | 1時間に11件の送信 | 11件目が 429、`Retry-After` に従って再試行の案内 | アプリ |
| 7 | 運営ツール（`npm run reports:admin -- --remote --env staging --database-id <staging REPORTS_DB id> --enable-decisions`、対話端末のみ）で申請を開く | 記録前は「承認」が無効、理由が表示される | 画面 |
| 8 | 公式情報源（または現地確認）を記録→承認 | 記録の2段階確認、`place_confirmed` 必須。記録後に承認が可能に | 画面、`admin_review_audit`・`new_spot_evidence_checks` |
| 9 | キュー→新規地点レビュー→export | 記録ありの申請は export できる。記録のない申請（旧CLIで承認）は止まる | `npm run reports:moderate`（`scripts/report-queue.ts` の新規地点レビュー・export、同じ `--remote --env staging` 指定）、DBトリガーのエラー |
| 10 | 写真ルート | `POST /v1/reports/{id}/photos` は 503 `photoEvidenceDisabled` | `curl`（App Attest なしで可） |
| 11 | 鍵の取り消し | 取り消した鍵からの申請は 403 | 運営の手順 |

テストデータの扱い：
- E2E の申請は、最後に運営ツールで却下（理由：対象外）する。staging から本番へ export・promotion しない。
- 90日の保持で、自動で最小化される。それより早く消す必要があるときは、既存の保持処理の手順で行う。
- challenge・assertion・鍵ID・Secret・端末IDを、Issue／PR／チャットに貼らない。

## 5. 本番相当のCPU再計測とエラー監視

staging で（本番と同じ Workers Free の条件で）：
1. `npx wrangler tail mannerpath-api-staging --env staging --format json > tail.jsonl` を流したまま、§4 を実行する。
   追加で、テスト用の端末から 20〜50件を時間を空けて送り、コールドスタートの割合を見る。
2. 集計：`cpuTime` の P50／P99／最大、10 ms 超の件数、`outcome` が `ok` 以外（`exceededCpu` など）の件数。
   probe と同じ集計方法（V1_PHOTO_FREE_NEW_SPOT.md §5）にする。
3. 判定の基準（案）：`exceededCpu`（1102）が0件で、10 ms 超が5%以下。これを超えたら、受付開始を止めるか、
   Workers Paid を検討するかを運営者が判断する（有料化はこの Lane では行わない）。
4. 本番の監視：Cloudflare ダッシュボードの Workers Metrics（Errors・CPU time）を日次で見る。GraphQL の
   `workersInvocationsAdaptive` で `status` 別に集計する（`scripts/free-tier-probe-analytics.ts` と同じ形のクエリを、
   本番の Worker 名で実行する）。`exceededCpu` が出たら、アプリの再送（新しい challenge・同じ冪等キー）で回復できて
   いるかを、申請の重複がないことで確認する。

## 6. 本番 migration と受付開始のチェックリスト

すべて未実施。各項目に運営者の承認が必要。

- [ ] staging で §3〜§5 が完了し、結果が記録されている
- [ ] #124（申請規約・プライバシーポリシー・App Privacy・年齢区分）承認済み
- [ ] Lane 1 のアプリ：写真なし送信、範囲外ピンの事前チェック、「自動では掲載されません」の完了文言
- [ ] Lane 4 の App Store 文言を写真なしに差し替え済み
- [ ] 本番 REPORTS_DB の migration 状況を `migrations list` で確認（0011 だけが未適用であること）
- [ ] 本番に 0011 を適用し、§3 手順5のクエリで確認。ロールバック SQL を手元に用意
- [ ] 本番の Secret（peppers）・App Attest の値・`CHALLENGE_RATE_LIMITER`・edge の IP レート制限を設定
- [ ] 写真関連のバインディングを設定していないこと、`/v1/config` が `photoEvidenceEnabled:false`
- [ ] `REPORT_REGISTRATION` を開く（運営者承認）→ `reports.available:true` を確認
- [ ] 受付開始後24時間：1102 エラー、429 の件数、申請の重複がないことを確認。問題があれば `REPORT_REGISTRATION=paused`
      と App Attest の有効化値の除去で受付を止める（STAGING_VERIFICATION.md 手順5）
