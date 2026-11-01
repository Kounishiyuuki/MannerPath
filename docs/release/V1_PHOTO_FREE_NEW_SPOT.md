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
| 独立確認の記録 | `new_spot_evidence_checks`（REPORTS_DB 0011）。`officialSource`（https URL）または `siteVisit`。確認日は受付日〜記録日（日本時間）。不変（更新・削除不可） |
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

## 3. 運営ツール（`npm run report-admin`）

新規地点の投稿に「独立した確認の記録」パネルを追加。確認方法（公式情報源／現地確認）・URL（公式情報源のみ、
https、認証情報・`#` なし、≤ 300）・確認日を入力し、既存と同じ2段階確認（`/api/evidence/confirm` → `/api/evidence/record`）
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
- この経路は今回の変更前から main にある受付処理そのもの（今回の追加は範囲チェック1回のみ）。CPUの大半は App Attest の
  署名検証と D1 往復と見込まれる（未分解）。
- 本番で10 msを超えて強制終了された場合、クライアントは同じ冪等キーで再送でき、二重登録にはならない（冪等性はテスト済み）。
  ただしチャレンジは使い捨てのため、再送は新しいチャレンジと署名が必要。
- D1：1申請あたりの書き込み行数は、D1 insights（同日の写真計測を含む集計）から概算で20〜30行（reports・moderation・
  冪等レシート・レート窓・チャレンジ・カウンター、索引を含む）。Freeの1日10万行に対し、数千件/日まで余裕がある（概算）。

**判定：写真なし申請は Workers Free で動作する（失敗0件）が、CPU 10 msを常に下回るとは言えない。** 有効化前に、
§6の本番相当環境での再計測と、超過時の挙動（エラー率）の監視を条件にする。

## 6. 本番有効化の手順と安全確認（いずれも未実施・運営者の別承認が必要）

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
