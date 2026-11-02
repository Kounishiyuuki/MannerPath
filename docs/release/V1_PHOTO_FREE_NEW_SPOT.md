# v1.0 写真なし新規地点申請（Lane 3 / 2026-11-02）

Status: **APIと運営ツールは実装済み・テスト済み。本番の受付は無効のまま。** 運営者の正式決定（2026-11-02）により、
v1.0では新規地点を写真なしで受け付け、写真1〜3枚付き申請はv1.1で追加する（Workers Freeでの写真受付はNO-GO：
`V1_PHOTO_FREE_RELEASE_PLAN.md`）。本番での有効化には、§6の手順・実環境E2E・運営者の別承認が必要。

## 1. 決定と安全条件

| 条件 | 実装 |
| --- | --- |
| 写真なしで申請できる | `POST /v1/reports` は以前から写真を要求しない（写真は別ルートで後から添付する設計）。変更なし |
| 必ず審査待ち、自動掲載なし | 申請は `report_moderation.state='pending'` で保存。公開には承認→キュー→新規地点レビュー→export→promotion の手動操作が必要（変更なし） |
| 投稿者の説明だけでは承認しない | `approvedPhotoRequired` を `independentEvidenceRequired` に置換。承認には「閲覧可能な承認済み写真（v1.1）」**または**「運営者が記録した独立確認」が必要 |
| 独立確認の記録 | `new_spot_evidence_checks`（REPORTS_DB 0011）。`officialSource`（https URL）または `siteVisit`。確認日は受付日〜記録日（日本時間）。運営者が「この位置に喫煙できる場所があることを、情報源の記載または現地で自分で確かめた」と明示（`place_confirmed = 1`、DBのCHECKで必須）。不変（更新・削除不可） |
| 公開経路でも同じ条件 | `proposeNewSpotReview`・`exportReview`（コード）と export トリガー `report_reviews_new_spot_evidence`（DB）。0009/0010 のトリガーは 0011 で置換（写真条件は 0010 と同一） |
| 既存の公開・出典・権利ルール | 変更なし（communityReported の単独申請条件、規約同意、日本国内ピン、提出者の独立性、#124）。公式情報源は**確認の根拠**であり、その文章・画像を転載する許可ではない |
| v1.0では写真APIを無効 | `REVIEWED_PHOTO_TERMS` が空のため、写真バインディングが揃っても `/v1/reports/{id}/photos` は 503 `photoEvidenceDisabled`、`/v1/config` は `photoEvidenceEnabled:false`（テストで固定） |
| 不正な位置 | 日本の範囲外のピンを受付時に 400（`proposedLocation: outside_service_area`）。以前は審査時にだけ拒否し、90日保存していた |
| 維持するもの | App Attest（v3封筒、チャレンジ使い捨て、カウンター）、冪等キー（再送は 200）、鍵ごとの上限（10件/時・50件/日）、本文・封筒サイズ上限、90日の最小化、監査 |

承認後の取り消し：記録は変更できないため、誤った確認記録は「却下」で扱う。旧CLIで独立確認なしに承認された申請は
レビュー・exportで止まる（fail closed）。

## 2. API契約（Lane 1向け）

変更点は「日本の範囲外のピンを 400 で返す」ことだけで、リクエスト・レスポンスの形は変わらない。

- 送信：`POST /v1/reports`、v3封筒（`schemaVersion:3`、`payload` = base64のJSON、`attestation` = keyId/challenge/assertion）。
- payload（`type:"missing"`）：`installId`、`idempotencyKey`（64 hex）、`proposedLocation`（**必須**、緯度20–46・経度122–154）、
  `acceptedTermsVersion`（`/v1/config` の `reports.termsVersion`）、任意で `observedOn`・`note`（≤ 280）・`claim`（`spotType` 必須、
  `hostName` ≤ 80、`hoursNote` ≤ 120 ほか）。`spotId` は送らない。
- 応答：201（新規）／200（同じ冪等キーの再送）／400 `invalidReport`（`detail` はパスとコードのみ。範囲外は
  `proposedLocation: outside_service_area`）／409 `termsVersionOutdated`／429（`Retry-After`）／503（受付停止・設定不備）。
- クライアントの判定：`reports.available == true` なら写真なしの新規地点を送ってよい。`photoEvidenceEnabled == false`
  の間は写真を求めない・選ばせない・送らない（v1.0は常に false）。v1.1で true になったときだけ写真を必須にする。
- 範囲外のピンは送信前にクライアントでも止める（サーバーは最終防衛）。
- 成功後の表示：「送信しました。運営が確認してから掲載を判断します（自動では掲載されません）」の趣旨。承認・掲載を約束しない。

## 3. 運営ツール（`npm run reports:admin`）

新規地点の投稿に「独立した確認の記録」パネルを追加。確認方法（公式情報源／現地確認）・URL（公式情報源のみ、
https、認証情報・`#` なし、≤ 300）・確認日を入力し、確認内容の欄（この位置に喫煙できる場所があることを自分で確かめた。投稿の説明や投稿者が示したURLだけを根拠にしていない）にチェックして、既存と同じ2段階確認（`/api/evidence/confirm` → `/api/evidence/record`）
で保存する。記録しても投稿は承認されない。記録がない間は「承認」ボタンが無効で、理由を日本語で表示する。読み取り専用
セッションでは記録できない。

## 4. v1.1 写真付き申請との互換

- 写真の経路（`community_evidence_photos`、R2アダプター、v2写真ルート、iOSの写真UI）は残したまま無効。
- 承認・公開の条件は「写真 **または** 独立確認」なので、v1.1で写真を有効にしてもDB移行は不要（0011 は追加のみ）。
- 申請モデルは同じ `reports`（`type:"missing"`）。写真の有無は `community_evidence_photos` の行の有無で区別できる。
- 写真PoCと検証結果（`src/poc/`、#363–#365・#369–#370）はそのまま保持する。

## 5. Workers Free 計測（写真なし申請、2026-11-01 18:42–18:48 UTC）

使い捨て probe Worker（`src/poc/free-tier-probe/worker.ts` に本物の `POST /v1/reports` をマウント）、既存の probe D1
（0011 を適用、合成データのみ）。Secret は毎回新規生成・非表示で登録、計測後に Worker ごと削除。CPU は `wrangler tail`（ms）。
ドライバー：`npm run free-probe:reports`（`scripts/report-intake-probe-run.ts`）。

| 実行 | 要求 | n | P50 | P95 | P99 | max | > 8 ms | 結果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20件 | `POST /v1/reports` 201 | 20 | 8 | 12 | 16 | 16 | 10 | すべて ok |
| 100件 | `POST /v1/reports` 201 | 100 | 7 | 10 | 15 | 18 | 21 | すべて ok |
| 100件 | 再送 200／範囲外 400／上限 429 | 各1 | 6／3／6 | | | | 0 | ok |
| 100件 | `POST /v1/app-attest/challenges` 201 | 108 | 4 | 6 | 7 | 9 | 1 | ok |
| 100件 | `POST /v1/app-attest/keys` 201（鍵登録、初回のみ） | 9 | 7 | 12 | 12 | 12 | 2 | ok |

- 例外・`exceededCpu` は0件。ただし写真PoCの判定基準（P99 ≤ 8 ms）は**満たさない**。Freeの10 msを超えた申請が
  100件中3件あったが、いずれも強制終了されなかった（tail の全279イベントで outcome は ok）。20件の実行ではコールドスタート直後のチャレンジ発行が最大23 ms。
- この経路は今回の変更前から main にある受付処理そのもの（今回の追加は範囲チェック1回のみ）。CPUの内訳は §5.1。
- 本番で10 msを超えて強制終了された場合、クライアントは同じ冪等キーで再送でき、二重登録にはならない（冪等性はテスト済み）。
  ただしチャレンジは使い捨てのため、再送は新しいチャレンジと署名が必要。
- D1：1申請あたりの書き込み行数は、D1 insights（同日の写真計測を含む集計）から概算で20〜30行（reports・moderation・
  冪等レシート・レート窓・チャレンジ・カウンター、索引を含む）。Freeの1日10万行に対し、数千件/日まで余裕がある（概算）。

### 5.1 CPUの切り分けと最適化（2026-11-03）

ローカル（Node 24、ウォーム状態、D1を除く）で段階別に計測：封筒の JSON+zod 0.003 ms、payload の base64・UTF-8・JSON・
重複キー検査・zod 0.026 ms、App Attest 検証（CBOR・SHA-256×2・ECDSA P-256）0.15 ms（P99 0.73 ms）、ハッシュ3種 0.04 ms。
**要求内の計算は合計 1 ms 未満で、P50 6〜7 ms の大半を説明しない。** Workers の CPU 時間には D1 呼び出しごとの
バインディング処理と、isolate 起動直後の JIT 前の実行が入るため、残りはそれらと見込まれる（workerd 内の内訳は未計測）。

| 案 | 内容 | 採否 |
| --- | --- | --- |
| A | レート制限の事前チェック（時・日の2窓）を1クエリに統合。1申請の D1 往復 6→5。上限の強制はコミット時のトリガーのまま | 採用（`src/reports/rate-limit.ts`、テスト追加） |
| B | probe の識別チェック（D1 2回）を isolate ごとに1回に。本番 Worker にはない probe 固有の負荷を計測から外す | 採用（probe のみ） |
| C | challenge 消費と鍵読み取りを1つの batch に統合 | 不採用：challenge を最初に消費する順序の保証をまたぐ変更で、改善見込み（往復1回分）に対しリスクが大きい |

### 5.2 再計測（2026-11-03、案A・B適用後、100件、`wrangler tail`）

| 要求 | n | P50 | P95 | P99 | max | > 8 ms | > 10 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /v1/reports` 201 | 100 | 6 | 14 | 35 | 35 | 8 | 5 |
| `POST /v1/app-attest/challenges` 201 | 113 | 3 | 7 | 19 | 19 | 2 | 2 |
| `POST /v1/app-attest/keys` 201 | 10 | 7 | 13 | 13 | 13 | 3 | 1 |

- 全227イベントの outcome は ok（`exceededCpu` 0件）。再送 200（6 ms）・範囲外 400（3 ms）・上限 429（4 ms）。
- 10 ms 超の申請5件の内訳：デプロイ直後の最初の3件（14〜19 ms、isolate のウォームアップ）と、後半の単発2件（24・35 ms）。
  それ以外の申請は 9 ms 以下。P50 は 7→6 ms に下がったが、テールは isolate 起動と単発のスパイクで決まり、コード側の
  最適化では消えない。**改善が小さいため、これ以上は追わない。**

**判定：写真なし申請は Workers Free で動作し（2回の計測で失敗0件・`exceededCpu` 0件）、定常状態の P50 は 6 ms。ただし
コールドスタートと単発スパイクで 10 ms を超える申請が数%あり、P99 ≤ 8 ms は満たさない。** Free の CPU 上限は
超過しても即座に強制終了されるとは限らないが、保証はない。強制終了されても、新しい challenge と同じ冪等キーで再送すれば
二重登録にならないことをテストで確認した（`test/new-spot-independent-evidence.test.ts`「a request cut off by the CPU limit…」）。
本番 GO の条件は §6 の staging 再計測と 1102 エラー率の監視。

## 6. 本番有効化の手順と安全確認（いずれも未実施・運営者の別承認が必要）

staging の手順と実機E2Eは [V1_PHOTO_FREE_STAGING_E2E.md](V1_PHOTO_FREE_STAGING_E2E.md)。


1. REPORTS_DB（staging→本番の順）に 0011 を適用し、テーブル・トリガー（`report_reviews_new_spot_evidence` のみ、0009/0010 のトリガーが消えていること）を読み取りで確認。
2. 申請規約・プライバシーポリシー・App Privacy（Other User Content、Precise Location、Device ID）・年齢区分の承認（#124 の写真以外の部分）。
3. App Attest の本番値、`REPORT_REGISTRATION` の再開、IPレート制限（edge）を設定。写真関連のバインディングは設定しない。
4. staging で実機 Release build による E2E：送信→審査待ち→独立確認の記録→承認→レビュー→export、範囲外ピン・再送・上限。
5. Workers Free の本番相当で CPU を再計測し、1102（CPU超過）エラー率を監視する仕組みを用意。
6. 運営者の有効化承認後に `reports.available:true` にする。`/v1/config` で `photoEvidenceEnabled:false` を確認。

## 7. Lane 1・Lane 4 との整合（要対応）

- **Lane 1**：作業中の `acceptsNewSpotProposals`（reports 有効なら写真なしで送信）と §2 の契約は一致。範囲外ピンの事前チェックと、
  「自動では掲載されない」趣旨の完了文言の追加を依頼。「Add at least one photo…」は写真受付が有効なときだけ表示。
- **Lane 4**：`V1_APPSTORE_FINAL_ASSETS.md` の候補文「写真を1〜3枚添えて報告できます」と「New-place proposals require 1–3 photos」は
  v1.0 と矛盾する。写真なしの文言（例：「新しい喫煙所を提案するときは、地図で位置を指定して報告できます。報告は運営が
  公式情報や現地で確認し、確認できた情報だけが掲載手続きを経て地図に反映されます。自動では掲載されません。」）への
  差し替えを依頼。Lane 3 は Lane 4 の文書を編集していない。

## 8. 写真PR（#363–#365、#369–#370）の整理方針

文書（計測結果・NO-GO）は残し、PoCコードは main に入れない。推奨：#363・#365 は文書PRとして残すか、`V1_PHOTO_FREE_RELEASE_PLAN.md`
に要約済みなので閉じる。#364・#369・#370 はブランチを残して閉じる（v1.1 の参照用）。merge／close は運営者判断。

## 9. 独立確認の安全性評価（2026-11-03）

| 観点 | 結論 | 根拠 |
| --- | --- | --- |
| 記録があるだけで承認されるか | されない。記録は承認可能にするだけで、承認は別操作（プライバシー確認のチェック＋2段階確認＋CAS） | `recordIndependentEvidence` は状態を変えない（テスト「approves nothing」）。承認の確認トークンは記録に使えず、逆も同じ（admin-server テスト） |
| 何を確かめたかが残るか | 確認方法・URL・確認日・記録者・時刻に加え、「位置と喫煙できる場所を確かめた」の明示（`place_confirmed`）が必須 | 未チェックは `placeConfirmationRequired` で拒否、DB も `CHECK(place_confirmed = 1)`。ブラウザで確認（§10） |
| 申請者の自己申告だけで承認・exportできるか | できない。記録は運営ツール（運営者セッション・書き込み可能モード）からのみ作成され、申請APIからは作れない | 申請の本文・URLは記録に入らない（テストで確認）。旧CLIで記録なしに承認された申請はレビュー（コード）と export（DBトリガー）で止まる |
| 申請者が書いたURLを根拠にできるか | 仕組みでは区別できない（運営判断）。運営ツールの確認文で「投稿者が示したURLだけを根拠にしない」を明示 | 公式情報源は運営者が自分で探した自治体・施設運営者のページに限る運用 |
| 記録の改ざん | 更新・削除はトリガーで拒否。誤記録は却下で扱う | テスト |
| 記録後に申請が変わったら | 記録時に CAS（`VERSION` に記録件数を含む）で古い画面からの記録を拒否。記録は未審査の新規地点申請にしか作れない | 前提トリガー・`staleDecision` テスト |
| 1人の運営者が記録と承認の両方を行えるか | 行える（現行の運用は運営者1名）。2人承認は v1.0 の要件にしていない | 要確認（§11） |

0011 の互換性・ロールバック：
- 既存データ：0010 までのDBに 0011 を当てても、既存の申請・審査状態は変わらない（テストでスナップショット比較）。0011 前に旧CLIで承認された写真なしの新規地点は、適用後もレビューで止まる。
- 冪等性：0011 は `CREATE TABLE`（`IF NOT EXISTS` なし）。`wrangler d1 migrations apply` は適用済みを `d1_migrations` で飛ばす。手で再実行しても1トランザクションで失敗し、何も変えない（テスト）。
- ロールバック：`services/api/migrations-reports-rollback/0011_new_spot_independent_evidence.sql`（migrations_dir の外なので自動適用されない）。0011 の export ゲートを外し、0009/0010 の写真専用ゲートを元の文のまま戻す。確認記録の表は監査記録として残す。ロールバック後、記録だけの申請は export できない（テストで確認・fail closed）。コードのロールバックは前の Worker バージョンへの戻しで、DBとは別に行う。再有効化は新しい migration で行い、0011 を再実行しない。

## 10. 運営ツールのブラウザ確認（2026-11-03）

ヘッドレス Chrome（CDP）で実際の運営ツール画面をデモデータ（写真なしの申請）で操作し、同じDBでレビュー・exportまで実行：
記録前は「承認」無効＋理由表示 → 確認内容の欄が未チェックだと記録できない → 2段階確認（要約に確認方法・確認日・確認内容）
→ 記録後に「承認」有効 → 承認（プライバシー確認＋2段階確認）→ DB の状態 `accepted`・記録1件 → キュー → 新規地点の候補に
`independentChecks: recorded` → レビュー作成 → export `exported`。写真待ち・記録なしの別申請は「承認」無効のまま。
この確認で、記録フォームの入力欄が1行に詰まっていた表示と、「現地で確認」でもURL欄が出る表示の不具合を見つけて直した（`ui.css`）。

## 11. 残る P0（本番の受付開始前に必須）

1. staging の作成（D1 2つ・Worker・Secret・rate limit binding）と 0001〜0011 の適用。**未作成**（`wrangler d1 list` に staging の DB がない）。
2. 実機 Release build による staging E2E（[V1_PHOTO_FREE_STAGING_E2E.md](V1_PHOTO_FREE_STAGING_E2E.md) §4）。
3. staging での CPU 再計測と 1102 監視の用意。テール（コールドスタート）の扱いを運営者が判断する。
4. #124（申請規約・プライバシーポリシー・App Privacy）の承認。
5. 本番 REPORTS_DB への 0011 適用（現在の適用状況は未確認）と、受付開始の運営者承認。
6. Lane 4 の App Store 文言の差し替え（§7）。
