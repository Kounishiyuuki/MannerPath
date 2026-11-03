# v1.0 写真なし新規地点：staging 準備・実機E2E・本番チェックリスト（Lane 3 / 2026-11-03、2026-11-04 更新）

Status: **2026-11-04 に staging を作成・デプロイし、REPORTS_DB は 0011 まで適用済み（§8）。実機 E2E は未実施。** 共通の前提（B1〜B4、0003 の取り込み、
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
| var | `REPORT_REGISTRATION` | E2E の間だけ `enabled`、終わったら `paused`（それ以外の値は `misconfigured` で fail closed） | `paused` は新しい鍵の登録だけを止める。既存の鍵からの申請は止まらない |
| var | `REPORT_REGISTRATION_MAX_PER_HOUR`／`_DAY` | 運営者が決める（B2） | |
| Secret | `REPORT_SUBMITTER_PEPPER`・`RATE_LIMIT_KEY_PEPPER` | staging 専用の新しい値（32文字以上） | 本番と共有しない。表示・ログ出力しない |
| binding | `CHALLENGE_RATE_LIMITER` | staging 専用 namespace | B2 |
| 規約 | `reports.termsVersion` | `/v1/config` が返す `CURRENT_REPORT_TERMS.version` | クライアントは古い版で送ると 409 `termsVersionOutdated` |
| 受付 | `reports.available` | 上の値が揃い、REPORTS_DB があるときだけ `true` | `photoEvidenceEnabled` は常に `false` |

## 2.1 必要なリソースと新規作成（2026-11-04 時点、すべて未作成）

| リソース | 名前 | 新規作成 | 備考 |
| --- | --- | --- | --- |
| Worker | `mannerpath-api-staging`（workers.dev） | 要 | 本番 Worker `mannerpath-api-production` とは別 |
| D1（正本） | `mannerpath-staging` | 要 | 検証用の probe D1（`mannerpath-free-tier-probe-*`）は流用しない。合成の正本データだけを入れる |
| D1（申請） | `mannerpath-staging-reports` | 要 | 同上。0011 を含む全 migration を当てる |
| Rate limit | `CHALLENGE_RATE_LIMITER`（staging 専用 namespace、例 `9801`） | 生成した設定のデプロイで作られる | 本番と namespace を共有しない |
| Secret | `REPORT_SUBMITTER_PEPPER`・`RATE_LIMIT_KEY_PEPPER` | 要（staging 専用の新しい値） | 2つは別の値にする（同じ値は `misconfigured`） |
| App Attest | staging 向けの bundle ID の App ID・ビルド番号 | アプリ側（Lane 1）で用意 | Apple Developer の App Attest capability が必要 |
| R2 | なし | 作らない | `wrangler.jsonc` の staging の `RAW_ARTIFACTS` は cron のソース確認専用。staging は cron がないので、デプロイは R2 を外した生成設定で行う |

### 2.2 生成した設定（`npm run staging:v1-config`）

`scripts/staging-v1-config.ts` が、コミット済みの `env.staging` から git 管理外の `.wrangler/staging-v1/worker.jsonc` を作る。
違いは「R2 なし」「staging の D1 の実 ID」「App Attest の値・登録の上限・`CHALLENGE_RATE_LIMITER`」の3点だけ。
プレースホルダー、コミット済みの ID（本番）、2つの D1 が同じ ID、形式の違う App ID は拒否する。
`REPORT_REGISTRATION` は常に `paused` で出力し、写真のバインディングと Secret は書かない。
`wrangler deploy --dry-run -c .wrangler/staging-v1/worker.jsonc` で、バインディングが D1×2・Rate Limit・vars だけになることを確認済み（2026-11-04、ダミー ID）。

## 3. staging を作って migration を当てる手順（未実施・各手順に運営者の承認が必要）

migration の正確な順序：

- `DB`（正本）：`migrations/0001`〜`0033` を順に（`wrangler d1 migrations apply DB`）。
- `REPORTS_DB`：`0001_report_store` → `0002_scale_indexes` → **0003_evidence_photos はガード付きの取り込み**
  （`npm run reports:migration -- prepare / apply-remote`、REPORTS_MIGRATION_RECOVERY.md）→ `0004_report_idempotency`
  → `0005_app_attest_key_revocation` → `0006_bulk_report_rejection` → `0007_photo_deletion_attempts`
  → `0008_admin_review_audit` → `0009_new_spot_photo_gate` → `0010_new_spot_photo_erasure_window`
  → `0011_new_spot_independent_evidence`。
- ローカルでの通し確認：`test/staging-local-d1.test.ts`（0001/0002 → 0003 の取り込み → 0004〜0011、台帳＝ファイル一覧と一致、FK）。

手順：

1. `npx wrangler whoami` でアカウントを確認する（表示されたトークン情報を貼らない）。
2. **【作成】** `npx wrangler d1 create mannerpath-staging` と `npx wrangler d1 create mannerpath-staging-reports`。
3. **【コミット】** 2つの ID を `wrangler.jsonc` の `env.staging` に書き、`test/deploy-config.test.ts` の「staging は
   プレースホルダー」の期待値を staging の ID に変える（本番と同じくレビュー付きの PR）。ガード付きの取り込みツール
   （`reports:migration`）はコミット済みの設定の ID と `--database-id` の一致を要求するため、これが必要。
4. **【DB】** `DB` に `npx wrangler d1 migrations apply DB --env staging --remote`。合成の正本データの投入は別の承認で行う
   （本番データをコピーしない）。
5. **【REPORTS_DB】** 0001/0002 だけを入れた一時ディレクトリで当てる → `reports:migration -- apply-remote --env staging
   --database-id <id> --confirm-staging mannerpath-staging-reports --file <prepare の出力> --expected-digest <sha256>`
   → `verify-remote … --completed true`（台帳が 0001〜0003 だけ）。STAGING_VERIFICATION.md の手順1〜3。
6. 当てる前の状態を記録する：`npx wrangler d1 migrations list REPORTS_DB --env staging --remote`（未適用が 0004〜0011）。
7. **【REPORTS_DB】** `npx wrangler d1 migrations apply REPORTS_DB --env staging --remote`。
8. 読み取りで確認する：
   ```sql
   SELECT name FROM d1_migrations ORDER BY id;  -- 0001〜0011 の11行
   SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'report_reviews_new_spot%';
   -- 期待：report_reviews_new_spot_evidence の1行だけ（0009/0010 のトリガーは消えている）
   SELECT sql FROM sqlite_master WHERE name='new_spot_evidence_checks';  -- place_confirmed 列があること
   SELECT count(*) FROM new_spot_evidence_checks;                         -- 0
   PRAGMA foreign_key_check;                                              -- 0行
   ```
9. 設定を作る：`npm run staging:v1-config -- --db-id <DB の id> --reports-db-id <REPORTS_DB の id> --app-id <Team ID>.<staging bundle ID>
   --attest-environment <production|development> --bundle-versions <E2E のビルド番号> --registration-max-per-hour <n>
   --registration-max-per-day <n> --limiter-namespace <staging 専用> --limiter-limit <1分あたり>`。
10. **【Secret】** `npx wrangler secret put REPORT_SUBMITTER_PEPPER -c .wrangler/staging-v1/worker.jsonc`、同じく
    `RATE_LIMIT_KEY_PEPPER`（対話入力。値を表示・保存しない。`openssl rand -base64 48` などで別々に作る）。
11. **【デプロイ】** `npx wrangler deploy -c .wrangler/staging-v1/worker.jsonc`（登録は `paused`）。
12. 読み取りの確認：`npm run --silent staging:security-smoke -- --base-url https://mannerpath-api-staging.<subdomain>.workers.dev
    --confirm-staging mannerpath-api-staging --expect-reports v3`。`/v1/config` が `photoEvidenceEnabled:false`。
13. **【E2E の開始】** 生成した設定の `REPORT_REGISTRATION` を `enabled` にして再デプロイ → §4 → 終わったら `paused` で再デプロイ。

0011 を戻す場合：`npx wrangler d1 execute REPORTS_DB --env staging --remote --file migrations-reports-rollback/0011_new_spot_independent_evidence.sql`
のあと、手順8のトリガーが `report_reviews_new_spot_photo_evidence`／`_viewable` の2つになったことを確認する。
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

## 6. 運営者1名での確認・承認（2名承認とのリスク差）

v1.0 は運営者1名で、独立確認の記録と承認の両方を行える。代わりに次を必須にしている：

- 承認の前に、申請者とは独立した証拠の記録（公式情報源の https URL か現地確認、確認日、`place_confirmed=1`、記録者）。
  API・運営ツール・DB トリガー（0011）の3段で、記録のない新規地点は承認・export できない。
- 記録は変更・削除できない（0011 の `no_update`・`no_delete` トリガー）。承認は `admin_review_audit` に `decided_by` 付きで残る。

| | 1名（v1.0） | 2名承認 |
| --- | --- | --- |
| 申請者の主張だけでの掲載 | 防げる（DB で拒否） | 防げる |
| 運営者の誤認（URL の読み違い、別の場所の確認） | 防げない。事後に監査で見つける | 2人目が気づける |
| 運営者による故意の誤記録 | 防げない。記録者・時刻が消せない形で残る | 共謀がなければ防げる |
| 運用の負荷 | 小さい | 承認待ちが増える |

緩和策：週1回、承認済みの新規地点の記録（URL・確認日）を見直す。誤りが見つかったら、既存の取り下げの手順で非公開にする。
2名承認にするかは、受付件数と誤掲載の実績を見て運営者が決める（要確認）。

## 7. 本番 migration と受付開始のチェックリスト

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

## 8. staging の現状（2026-11-04、承認のもとで実行）

| 項目 | 状態 |
| --- | --- |
| D1 `mannerpath-staging` | `86435c50-daf0-4d6a-b792-ae5ecdba84cd`（APAC）。`migrations/0001`〜`0033` 適用済み（台帳33行、`PRAGMA foreign_key_check` 0行）。正本データは空（promotion 未実施） |
| D1 `mannerpath-staging-reports` | `2a6e9bf2-4bc1-4394-885b-745d76c80158`（APAC）。0001・0002 → 0003（運営者が対話端末で取り込み）→ 0004〜0011 適用済み。台帳11行、FK 0行、`report_reviews_new_spot_evidence` のみ、`new_spot_evidence_checks`（`place_confirmed` 列あり、0行、変更・削除禁止のトリガー3つ） |
| Worker `mannerpath-api-staging` | `https://mannerpath-api-staging.happywestyuki.workers.dev`。生成した設定でデプロイ（R2・cron・写真なし） |
| vars | `REPORT_ATTESTATION=required`、`REPORT_REGISTRATION=paused`、App ID `58A7G4U27M.com.kounishiyuuki.MannerPath`、環境 `development`、ビルド `7`、登録上限 10/時・30/日 |
| Rate limit | `CHALLENGE_RATE_LIMITER` namespace `9801`、60 requests/60s |
| Secret | `REPORT_SUBMITTER_PEPPER`・`RATE_LIMIT_KEY_PEPPER`（別々の乱数、値はどこにも保存していない） |

App Attest の値は、アプリの実際の構成から取った（`project.pbxproj`：`DEVELOPMENT_TEAM = 58A7G4U27M`、
`PRODUCT_BUNDLE_IDENTIFIER = com.kounishiyuuki.MannerPath`、`CURRENT_PROJECT_VERSION = 7`、`MannerPath.entitlements` の
`appattest-environment = development`）。staging 専用の bundle ID はないので、本番と同じアプリの App ID を、Xcode の Debug
ビルド（App Attest `development`）として使う。TestFlight で試す場合は、環境を `production` にして設定を作り直す。

### 8.1 API の確認（2026-11-04、App Attest なしでできる範囲）

| 確認 | 結果 |
| --- | --- |
| `/v1/config` | `available:true`・`attestation:appAttest`・report v3 のみ・`photoEvidenceEnabled:false` |
| 登録の challenge | `503 registrationPaused` |
| 未登録の鍵の report challenge | `403 keyNotRegistered` |
| 未知の challenge での申請 | `403 challengeInvalid` |
| 写真 API | `503 photoEvidenceDisabled` |
| `CHALLENGE_RATE_LIMITER` | バインディングは付いている（`wrangler versions view`）。しかし1つの IP から 200件/7秒、180件/70秒を送っても **429 は0件**。Cloudflare の Rate Limiting はロケーションごとの近似で、緩いフィルターとして動く（公式文書）。申請の上限は別の層で守られている：鍵ごとの未使用 challenge 3件、登録 challenge の全体上限1000件、登録 10件/時・30件/日、申請 10件/時・50件/日（D1 トリガー） |
| `/v1/readiness`・`staging:security-smoke` | 合成の正本データ投入後（下記）：readiness 200 `completed`、smoke `PASS`（v3、photosDisabled） |

`reports.available` と実際の受付：`available` は App Attest の設定と REPORTS_DB の有無だけで決まり、`REPORT_REGISTRATION` は見ない。
これは設計どおり（`paused` は新しい鍵の登録だけを止め、登録済みの鍵からの申請は続く）。アプリは登録時の 503 を
`serviceUnavailable` として扱い、鍵を消さない（`ReportAuthorizer.swift`）。不一致による誤動作はないので修正はしない。
staging の受付自体を止めるときは、生成した設定から App Attest の値を外して再デプロイする（`available:false`、503 `attestationUnavailable`）。

合成の正本データ（2026-11-04 投入）：ソース `staging-synthetic-test`、スポット4件「【テスト】MannerPath staging 合成スポット 1〜4」
（東京駅周辺の座標、URL は `https://example.invalid/…`）、タイル 14/14552/6451・14/14553/6451。リポジトリの
ingest → resolve → publish → promotion bundle の経路で作った SQL（sha256 `8ec4af90…ebc5`）を、空の DB に1回だけ適用した。
本番データはコピーしていない。provenance の rule 名には Taito のパーサーの識別子が残る（中身は合成）。

### 8.2 Lane 1 に渡す設定（実機 E2E）

- Debug 構成で実機にビルドする（署名は Automatic、Team `58A7G4U27M`）。Debug には API の URL がないので、ビルド設定で渡す：
  `xcodebuild … -configuration Debug MANNERPATH_API_BASE_URL=https://mannerpath-api-staging.happywestyuki.workers.dev`
  （または Xcode でコミットしない xcconfig に書く）。Release の本番 URL は変えない。
- `CURRENT_PROJECT_VERSION` は `7` のまま（変えたら staging の `--bundle-versions` も合わせて再デプロイ）。
- 規約の版は `/v1/config` の `reports.termsVersion`（現在 `report-terms.2026-09-30.draft`）に従う。
- 地図には合成スポット4件（東京駅周辺）だけが出る。

### 8.3 実機 E2E の当日の手順

1. Lane 1 の Debug ビルド（§8.2）を実機に入れる。
2. `npx wrangler tail mannerpath-api-staging -c .wrangler/staging-v1/worker.jsonc --format json > tail.jsonl` を流す。
3. 生成した設定の `REPORT_REGISTRATION` を `enabled` にして `npx wrangler deploy -c .wrangler/staging-v1/worker.jsonc`
   （`npm run staging:v1-config` は常に `paused` を出すので、出力ファイルだけを手で変える。コミットしない）。
4. §4 のシナリオ 1〜11 を行う。E2E で必ず確かめる項目（2026-11-04 運営者の指示）：
   - CPU：`cpuTime` の分布と、`outcome` が `exceededCpu`（1102）の件数。
   - 冪等性：シナリオ3・4（同じ下書きの再送は 200 で同じ reportId、内容を変えた再送は 409）。
   - 独立確認なしの公開防止：記録のない申請は承認ボタンが無効で、旧 CLI で承認しても export が DB で拒否される（シナリオ7・9）。
   - rate limit：申請の上限（シナリオ6、11件目が 429）。challenge の IP 制限は、実機と同じネットワークから正規の端末が
     送っている間に `curl` で登録用 challenge を1分に100件以上送り、429 が返るか・実機の申請が止まるかを記録する
     （2026-11-04 の 403 だけの試験では有効性を判断していない。近似の制限として暫定許容）。
   - 運営ツールでの記録→承認→新規地点レビュー→export（シナリオ8・9）。
5. 終わったら `npm run staging:v1-config -- …`（同じ引数）で `paused` に戻して再デプロイ。登録済みの鍵からの申請を止める
   必要があれば、App Attest の値を外した設定でデプロイするか、運営ツールで鍵を取り消す。
6. `tail.jsonl` を §5 の方法で集計する（`cpuTime` の P50／P99／最大、10 ms 超の件数、`outcome` が `ok` 以外＝1102 の件数、429 の件数）。
