# 本番公開前ゲート：管理者の確認・実行順序

状態は **HOLD / UNVERIFIED**。#422はローカル証拠照合、#414は合成保持リハーサル、#420は金沢ホテル追加候補とpromotion手順の整備。
merge、local23項目pass、合成513→516→522は、本番状態・権利・Cron採用・公開の承認ではない。
2026-11-09のproduction-release-gates-reportはmain `2f8d465` に対する履歴であり、GET403・Wrangler認証不足のため本番状態は未取得。
この手順の作成でも本番操作・権利承認は行っていない。

## 1. 作業場所・証拠・権限

承認された管理端末のcleanなrelease checkoutを使う。repo rootで`git status --short --branch`、`git rev-parse HEAD`。
以下のCLIはすべて`services/api`から、Node>=24・lockfileに従いインストール済みのWrangler4.156.0で実行する。
`npx --no-install`により別バージョンの自動取得を避ける。認証は管理者の承認済みsession/秘密管理経路を利用し、tokenの作成・scope拡大はこの手順では行わない。
`whoami`、環境変数一覧、debug/verboseログ、raw settings/version dumpを共有しない。secret値は取得・表示しない。

記録するのはUTC時刻、担当、対象accountの私的参照、Worker名、active version ID/割合、DB ID/name/stream、チェック結果と承認記録への参照。
生DB・SQL export・申請・鍵・署名URL・Cookie・Authorization・token・Access証明はGit/PR/CI artifactへ置かない。
画面の値は必要なmetadataだけ転記し、編集/保存/secret revealをしない。画面名は変わり得るため対象IDも照合する。

| 権限 | 用途 | 不足時 |
| --- | --- | --- |
| 対象accountのWorkers Scripts Read等、endpointで受理される読取権限 | deployment、version別binding、Cron、secret名 | UNVERIFIED / STOP。別accountやWrite権限へ勝手に切替えない |
| 対象account/DBのD1 Read | database identity、SELECT、schema/ledger、検査PRAGMA | UNVERIFIED / STOP。Console利用時も以下の読取SQLだけに限定 |
| Accessの既存許可identityと、設定/監査を閲覧できる担当 | 保護された公開GETと403調査 | 許可された管理者へ引継ぐ。保護を無効化しない |
| Metrics/契約・請求の閲覧権限、運用判断権限 | 使用量・実plan・費用上限・担当受任 | Cron採用は未承認のまま |

[Worker schedules API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/)と
[secret名一覧API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/list/)は読取scopeを受理する。
[D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)もD1 Readを受理する。
APIのHTTPメソッドがPOSTでもSELECTはデータ読取だが、任意SQLを実行してよいという意味ではない。

## 2. 読み取り専用チェック（1行ずつ判断して実行）

### A. Worker版と実binding

```sh
npx --no-install wrangler deployments list --env production --json
```

期待：Workerが`mannerpath-api-production`、現在のdeploymentでactive versionが1つ・100%。履歴の版をactiveと取り違えない。
管理画面のWorkers & Pages→対象Worker→Deploymentsで同時刻の状態と照合する。
**STOP**：認証/権限不足、名前違い、複数版、取得中の版変更、表示とCLIの不一致。

同じactive versionの詳細/Bindings画面から、D1のbinding名`DB`と`REPORTS_DB`、各database UUIDを確認する。
DB一覧/詳細でUUIDとname・accountを独立照合し、ローカル`wrangler.jsonc`は比較材料にだけ使う。
DBはBLUE/GREENで変わり得る。REPORTS_DBはdurableで切り替えない。両者のIDは別で、stagingとも重複しないこと。
独立targetへ確認済みID/nameを記録する。実versionのbindingを閲覧できなければUNVERIFIEDでSTOP。
plain varsやsecret値を含み得るsettings全体を取得して、後からマスクする方法は採らない。

### B. DB identity・migration・復旧

`MP_DB_ID`、`MP_REPORTS_ID`はAで独立確認したUUIDを管理端末で設定する（認証情報ではない）。両IDが空/同じ/stagingなら実行しない。
次の`$MP_DB_ID`に対するコマンドを1件ずつ実行し、`$MP_REPORTS_ID`にも同じ検査を実施する。

```sh
npx --no-install wrangler d1 info "$MP_DB_ID" --json
npx --no-install wrangler d1 execute "$MP_DB_ID" --remote --json --command "SELECT name, applied_at FROM d1_migrations ORDER BY name;"
npx --no-install wrangler d1 execute "$MP_DB_ID" --remote --json --command "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name;"
npx --no-install wrangler d1 execute "$MP_DB_ID" --remote --json --command "PRAGMA quick_check;"
npx --no-install wrangler d1 execute "$MP_DB_ID" --remote --json --command "PRAGMA foreign_key_check;"
npx --no-install wrangler d1 time-travel info "$MP_DB_ID" --json
```

期待：infoのidentityがAと一致、ledgerが重複/抜けのない承認済みprefix、schemaがそのprefixのローカル参照と一致、quick_check=`ok`、FK違反0。
`d1 info`は使用量も問い合わせるためMetrics閲覧権限不足で失敗し得る。その場合は既存のD1詳細画面、または承認済みAPIクライアントの
`GET /client/v4/accounts/{reviewed-account}/d1/database/{reviewed-UUID}`でidentityを確認する。取得不可はUNVERIFIEDとし、権限を勝手に拡大しない。
FK結果は表名/rowid等を含み得るため私的に判定し、共有するのは違反件数だけ。schemaも私的に比較し、生metadataをPRへ貼らない。
検査もD1使用量/負荷を消費するため担当が実行窓を決め、timeout/負荷増大時は反復しない。
Time Travelはbookmark/復旧可能期間の取得のみ。restoreは実行しない。bookmarkは私的記録に残し、実操作直前に更新する。

ローカルの`migrations/*.sql`と`migrations-reports/*.sql`の名前を各ledgerと突合し、未適用だけをpendingにする。
既適用SQLのbytesはledgerの名前では証明できないため、schema比較と既存のmigrationレビュー/復旧記録も確認する。
before-migrationが受理する履歴集合はDB0031–0033 / REPORTS0004–0011、before-deployは両pending空。
履歴が別なら適切な再レビューを先に行い、チェックを緩めない。

**STOP**：ledger不存在、未知/重複/部分適用、schema相違、FK違反、quick_check不正、対象不明、bookmark/復旧手順未確認。
CREATEでledgerを作らない。過去0003復旧資料と後日の適用済み観測を混同せず、現在の復旧完了記録を確認する。
`d1 migrations list`はWrangler4.156.0内部で`initMigrationsTable`→`CREATE TABLE IF NOT EXISTS`を呼ぶので、厳密な読取では使用しない。
`production:v1-check`もこれを呼び、条件付きPOST probeがあるためここでは実行しない。

### C. 現在のCronとsecret名

CronはWorker→Settings/Triggersの**現在の設定**を閲覧する。Worker版にversion管理されないためdeployment履歴から推測しない。
APIを使う管理者は既存認証クライアントから以下のGETだけを行い、`result[].cron`とUTC観測時刻のみ記録する。

```text
GET /client/v4/accounts/{reviewed-account}/workers/scripts/mannerpath-api-production/schedules
```

expected-targetの`currentCrons`へ実観測を転記する。空を期待しても実取得なしに`[]`で埋めない。
**STOP**：未取得、未知のschedule、candidateとcurrentの混同、account/Worker不一致。5分候補との不一致を直すために有効化しない。

```sh
npx --no-install wrangler secret list --env production --format json
```

これは名前一覧用で、値を返す操作を使わない。共有記録は必要な3名の存在/不在だけ。
before-deployには`REPORT_SUBMITTER_PEPPER`と`RATE_LIMIT_KEY_PEPPER`の存在が必要、閉鎖段階では`REPORT_APP_ATTEST_APP_ID`の不在が必要。
名前の存在は値の正しさの証明ではない。before-migrationでpepper不足はUNVERIFIED、before-deployではFAIL。
**STOP**：取得不可、想定外の受付設定、必要名不足。secret put/delete、既存pepperの再生成で解決しない。

### D. config/readiness GETとHTTP403の切り分け

認証不要としてレビューされた正規originの場合に限り、body/headersを保存せずstatusを確認できる。
curlの`-q`で個人設定、`--max-redirs 0`で別originへの追従を避ける。Access保護下では、既存の許可された管理者sessionで同じ正規URLを閲覧する。
Cloudflare管理API tokenをアプリのGETへ送らない。

```sh
curl -q --silent --show-error --max-time 15 --max-redirs 0 --output /dev/null --write-out '%{http_code}\n' https://mannerpath-api-production.happywestyuki.workers.dev/v1/config
curl -q --silent --show-error --max-time 15 --max-redirs 0 --output /dev/null --write-out '%{http_code}\n' https://mannerpath-api-production.happywestyuki.workers.dev/v1/readiness
```

200だけでは完了しない。許可された画面でJSONの`readiness.completed=true,state=completed`、閉鎖段階の
`config.reports.available=false,photoEvidenceEnabled=false`、schema/termsを確認して必要項目だけ転記する。
readinessはDB UUID/version IDを返さないためAのmetadataと同時刻で相関させる。未配備candidateの成功とはしない。

| 403の調査観点 | 保護を変えずに確認する証拠 | 判断 |
| --- | --- | --- |
| 認証 | そのURLを保護するAccess application、既存identityのsession期限、許可された認証経路。管理API OAuthとアプリAccessは別 | session不足でも原因確定まではUNVERIFIED |
| Access制御 | 担当が既存Access監査で同時刻/hostname/pathのdeny理由、group/device posture等を閲覧 | policyと正規利用者の一致を調査。policy削除/迂回禁止 |
| 権限 | 管理APIの401/403・scope不足と、公開GETの403を別記録。WAF/security eventsは閲覧可能な担当が確認 | API token不足からreadiness障害を推定しない |
| endpoint/route設定 | active版のrouter、正規custom domain/workers.dev有効状態、route/path、前段proxyや実行環境の制限 | code上のreadinessは200/503だが、旧版や前段が403を返す可能性は未確定 |

`src/app.ts`の現行`GET /v1/readiness`ハンドラに403分岐がないことは、実リクエストがその版に届いた証明ではない。
UTC/statusと、利用可能なら秘密を含まないrequest/Ray IDだけで監査を相関させる。Cookie、token、redirect URLのquery、生ログは共有しない。
**STOP**：403、redirect、timeout、非JSON、未完了、binding/版を相関できない場合。成功とも本番障害とも断定しない。
別hostname/IP/VPNへの切替、origin直叩き、保護解除、ヘッダ偽装で回避しない。
[403の公式説明](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-403/)と
[Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)を参照。

## 3. ローカル証拠照合と実行順序

手順は一括実行しない。全段階で未知はUNVERIFIED、失敗はSTOP。書込段階はこの文書による許可ではない。

| 順序 | 管理者が完了させること | STOP条件 |
| --- | --- | --- |
| 1 | §2の実identity/ledger/schema/版/Cron/secret名、復旧記録と戻す明示versionを確認 | 未取得・不整合・復旧未確認 |
| 2 | migration不足があれば別承認で適用/検査。本手順では実行しない | 未適用・部分適用のままsnapshotを次段へ使わない |
| 3 | 対象source/権利の事前レビュー、DATA_DB exportの対象・低負荷窓・私的保存先・権限を別承認 | export未承認、schema不一致、REPORTS_DB選択、権利懸念未解決 |
| 4 | DATA_DBコピー取得、ローカルdry-run、最終GREENのDTO/notice/detail/版比較、bundle/plan digest固定 | refusal・件数/DTO/出典/整合性/タイルrevision不一致、snapshot変更 |
| 5 | sourceごとの最終G5（権利/ABR代表点/施設掲載/直近再確認/固定digest）を記録 | 未承認、red health、運営者の異議、新制限。local成功で代用しない |
| 6 | 本番操作承認後だけ新GREEN作成/migrate/import/finalize→GREEN readiness/tile検査 | G5/実施承認なし、不完全GREEN、DTO/整合性不一致。BLUEとREPORTS_DBを触らない |
| 7 | 別承認でDBのみGREENへ。公開GET監査・config/notices・監視→受入までBLUE保持 | 失敗なら別許可担当がDBをBLUEへ戻す。REPORTS_DBは切替えない |

段階3のexportはapplication dataを変えなくてもDBをlockしD1 Writeが必要なので、**読取確認コマンド群とは別操作**。
今回は実行しない。承認後のコマンド/ローカル変換とdry-runの全chainは
[promotion runbook](ID_PRESERVING_PROMOTION_RUNBOOK.md)を使う。REPORTS_DB全体exportは不要であり、取得しない。
金沢3施設とホテル6施設は別promotion。ホテル用snapshotは3施設がliveとなった後に取り直す。
`expect-added`は実snapshotの初回local実行（同CLIでは省略可能）のsource別結果をレビューして固定する。
その出力をbuildし、承認後に再生成しない。合成の6件を本番期待値として固定しない。

same-DBのローカルpreflightは§2で実取得した独立target/evidenceだけを入力する。

```sh
npm run production:preflight -- --stage before-deploy --commit <reviewed-40-hex-SHA> --expected-target <private-target.json> --evidence <private-evidence.json>
```

証拠のschema/正確なdigestは[#422の説明](CLOUDFLARE_PRODUCTION_PREFLIGHT.md)に従う。未確認の8管理者ゲートはnullを維持。
before-migrationは歴史的pending集合の場合だけ使う。15分以内の同一checkout/config/targetに限り相関させる。
UNVERIFIED(exit3)/FAIL(exit1)で先へ進まない。REVIEW_COMPLETE(exit0)も管理者の主張の内部整合性であり操作許可ではない。
BLUE→GREENの予定binding不一致をsame-DB preflightで無理に通さず、切替後の確定targetで再検査する。

## 4. Cron採用の判断票（全項目UNVERIFIEDのまま）

`2-57/5 * * * *`は候補であり確定値ではない。既存の
[容量・候補比較](V1_RETENTION_CAPACITY.md#6-最終評価5分間隔を確定しない2026-11-09)を使い、以下を私的運用記録へ記入する。

| 項目 | 必要な記録/判定 | 現在 |
| --- | --- | --- |
| 頻度/期限 | 総流入上限、期限到来量、滞留、許容遅れ、5分/15分/1時間比較と採用理由 | UNVERIFIED |
| CPU | 別許可された測定環境/版/UTC、scheduled CPU分布・最大、1102、失敗/重複/抜け | UNVERIFIED。Node CPUは代用不可 |
| D1 | DB別/アカウント全体の実read/write（索引込み）/storage、API等の負荷を含む残余と安全余裕 | UNVERIFIED。本体40行×回数を課金上限としない |
| 料金 | 実plan、契約枠、Logs保存量・外部出力、上限金額/通貨/期間、超過前の停止条件と決裁者 | UNVERIFIED。公表価格から契約を推定しない |
| 監視 | 担当の実名/受任、初日1時間ごと・以後毎日、代行、連絡先、観測coverage/欠測時の扱い | UNVERIFIED。自動通知は未実装 |
| 運用承認 | 許容遅れ/検知遅れへの同意、停止/再開権限、rollback訓練/戻す版/Triggersの順序、採用間隔の承認参照 | UNVERIFIED |

初回実Cron/CPU測定もdeploy等を伴うため別承認。今回は既存資料を整理するだけで測定/有効化しない。
金額上限・担当が空ならHOLD。間隔変更時はplan/dispatcher予約Cron/health鮮度判定/capacity/対象テストの同時レビューが必要。
生成JSONだけ編集しない。[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)・
[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)は比較資料で、実accountの証拠は別取得。

通常の異常時は全受付を止め、健全な保持は続ける。古いWorkerへ戻すときは全受付停止/PASS→retention-off/PASS→Cron削除→
20分以上待ちTriggers空/disabled以外なし/次回なしを確認→PASS→明示version rollback→App ID不在確認。
復元後は受付閉鎖のままfull receipt/schema検査と必要最小化。具体手順は[V1 intake §6](V1_PRODUCTION_INTAKE.md)を使う。
正式規約・受付開始・実機E2EはG5/Cronとは別ゲートで、いずれも未確認を承認済みにしない。
