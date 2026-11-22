# 1.0 (8)／次のRC候補 1.0 (9) の提出素材準備（2026-11-22）

**SUBMISSION: BLOCKED のまま。** この文書は準備の照合結果で、承認・ASC転記・本番操作は行っていない。
ゲートは [canonical Gate](../../../V1_APP_STORE_RELEASE_GATE.md) のとおり全項目OPEN。

- **次のRC候補：1.0 (9)（運営者決定 2026-11-22）。** 正式な申請規約を同梱する必要があるため（§8）。1.0 (8) は
  draft規約のみを同梱しており、正式受付の提出ビルドにはできない。以下の照合は1.0 (8) のソースに対するもの。
- 旧：暫定RC 1.0 (8)（同日決定）。アプリのソースは `main` `159bee8` から `3749a56` まで `apps/` に差分なし
  （その間の15コミットは `docs/` のみ）。16構成すべて `MARKETING_VERSION = 1.0` / `CURRENT_PROJECT_VERSION = 8`。
  ソースの再ビルドは不要。提出には別途、配布署名のarchiveが必要（G14、運営者判断）。
- 範囲：写真なし・テキストの新規地点申請あり（2026-11-02決定）。本番受付は準備が整うまで停止のまま。

## 1. App Store説明文（G8）：[description-ja.txt](description-ja.txt)

1.0 (8) のコードと照合し、本文の変更は不要と判断した。照合した記述：

| 記述 | 根拠（1.0 (8) のコード） |
| --- | --- |
| 一時的な通信障害では同じ申請を自動再送 | `ReportModel.swift:676` `maxRetries = 2`（Review Notesの「最大2回」と一致） |
| Appleのマップへ案内を引き継ぎ | `Core/Mapping/MapKitNavigation.swift` |
| Apple Watch・ウィジェット | `MannerPathWatch Watch App`、`MannerPathWidgets`、`MannerPathWatchWidgets` |
| 写真の添付・送信は提供しない | `ReportPhotos.swift:18` `reviewedPhotoTerms = []` のため Release の写真ポリシーは無効（DEBUGの試験用スタックのみ写真を有効化） |

**提出当日に照合が必要：掲載地域の文。** 本文の6地域（台東区・港区・江東区・武蔵野市・大阪市・京都市）は
2026-10-15の本番GET観測（[production-recheck.json](../../store-screenshots/production-recheck.json)、513件／6 source）に基づく。
リポジトリには審査済みsourceが20件ある（§5）が、本番に配備済みかは今回確認していない。
当日の本番観測で地域を確定し、本文・Review Notes・スクリーンショットを同時に直す。未配備の地域は加えない。

## 2. Review Notes（G12）：[review-notes.txt](review-notes.txt)

コードとの不一致は見つからなかった。ただし**運営者判断が必要な矛盾が1点**ある：

- 手順4は審査担当者に実機で実際の申請を1件送らせる。一方、本番受付は「準備が整うまで停止」（G16）。
  審査時に受付が停止中だと、審査担当者は申請できない（アプリは「受付停止」と表示する。2026-11-21の1.0 (8)
  Release実機で確認済み、[device matrix](../../../beta-e2e/device-release-matrix.md) の1.0 (8)節）。
- 選択肢：(a) 審査提出までに本番受付をG16/G23の承認のもとで開ける、(b) 署名済みビルドで許可された申請フローの
  録画を用意し、手順4の代替として明記する（手順4に既に記載あり）、(c) 審査中も停止とし、手順4を「受付停止の表示を確認」に
  書き換えて説明文の申請機能の記述も合わせる。(c) は説明文の範囲変更になる。
- **運営者決定（2026-11-22）：(a)。** ただしG16・G23と関連する安全性の確認が完了するまで本番受付は停止のまま。
  受付を開ける操作は別途の承認で行う。Review Notes手順4の文面は(a)のまま変更しない。

## 3. 掲載地域の説明（G9）

アプリ内は「掲載範囲は地域によって異なります」と掲載がない場合の表示のみ。ストア外（サポートページ）向けの文案：

> MannerPathが現在掲載している地域は、東京都の一部（台東区、港区、江東区、武蔵野市）、大阪市、京都市です。
> 各地域でも、公的機関などが公開している情報を出典とする場所の一部を掲載しており、すべての喫煙場所を網羅するものではありません。
> 掲載地域外では場所は表示されず、掲載がないことを表示します。掲載地域は審査済みの情報源を追加する際に更新します。
> 目的地を検索すると、その周辺の掲載場所を確認できます（例：「浅草駅 東京」）。

地域名は§1と同じく提出当日の本番観測で確定する。公開Webへの反映は別作業（運営者承認）。

## 4. スクリーンショット撮影手順（G10）

既存候補は**1.0 (3) のRelease Simulator画像**（[store-screenshots](../../store-screenshots/README.md)）。
1.0 (3) の撮影日（2026-10-15）以降に `ContentView.swift` だけで22コミットの変更があるため、**1.0 (8) で全数を撮り直す**。

1. 準備：専用のSimulator（iPhone 6.9インチ、1320 × 2868）、日本語、個人データなし。
   本番Release originへのGETを使うため、撮影は運営者の許可後に行う（読み取りのみ、書き込みなし）。
2. 撮影：[README「Capture and validation tooling」](../../store-screenshots/README.md#capture-and-validation-tooling) の
   `StoreScreenshotCaptureUITests` を `TEST_RUNNER_MP_STORE_CAPTURE=1` で実行し、添付を書き出す。
3. 場面：地図（シートを畳み、地図のクレジットを残す）、一覧、目的地検索、詳細（利用条件・情報源）、Appleのマップへの引き継ぎボタン。
   報告フォームはv1.0の申請機能を写す場合のみ。写真の画面は写さない。
4. 検証：`scripts/test-store-screenshots.py`、`scripts/validate-store-screenshots.py <capture-manifest.json>`。
5. Watch：掲載地域内でペアリング済みの実機（Series 9）で撮る（[WATCH_DEVICE_CAPTURE.md](../../store-screenshots/WATCH_DEVICE_CAPTURE.md)）。
   掲載地域外では撮影不可。スナップショットの注入はしない。
6. 権利と承認：全画素の確認、地図・提供元表記の保持、G5の承認後にのみASCへアップロード。

## 5. リポジトリ内のデータ品質（G19の準備、本番観測ではない）

ローカルD1のみ（`remoteBindings: false`）。リモートDBには接続していない。

```sh
cd services/api   # Node 24、NODE_OPTIONSなし
npx wrangler d1 migrations apply DB --local
npm run local:pipeline -- <source-id>   # local-pipeline.ts が受け付ける20 sourceすべて
npm run local:quality
```

結果（2026-11-22）：`failedChecks: 0`（16項目すべてpass）。publishedSpots 647、publishedTiles 103、空tile 0、
全tile z14、tile part上限内、OSM由来なし、area anchorは全て `areaApproximate`、確度の過大表示なし。

最近傍距離0 mの組（10件・4建物）は調査済み：港区データで階ごとに別ページを持つ**別の喫煙場所**で、区のCSVが同じ建物の
全階に同じ緯度経度を与えている（例：日比谷フォートタワー 1F/2F/11F、105/106/107.html）。重複ではないため削除・統合しない。
階数の構造化（`floor` はNULL、名称にのみ階がある）とピンの重なりは将来課題として #452 に記録。
金沢のホテル系fixture（`*-kanazawa-*`）は `local:pipeline` の対象外のため、この結果に含まれない。
本番の掲載内容（G19）は別途、許可されたGETで当日に確認する。

## 6. プライバシー申告の整理（G2/G3）

| 型 | アプリのmanifest（1.0 (8)、`MannerPath/PrivacyInfo.xcprivacy`、`8cc409c`） | App Privacy候補（[json](app-privacy-candidate.json)） |
| --- | --- | --- |
| Other User Content | 収集・関連付けあり・トラッキングなし | 同じ |
| Device ID | 同上 | 同じ |
| Precise Location | 同上 | 同じ |
| Customer Support | なし | 収集・関連付けあり（メール問い合わせ） |
| Email Address | なし | 同上 |
| Photos or Videos | なし | アプリ内収集なし |

- manifestと候補はアプリ内収集の3型で一致する。
- **運営者決定（2026-11-22）：Customer Support と Email Address はASCで申告する（Collected／Linked／Not Tracking／
  App Functionality）。Privacy Manifestは現状の3型を維持。** ASCへの反映はまだ行わない。
  根拠：アプリの問い合わせ導線は `mailto:` リンクのみ（`AboutPrivacyView.swift:25`）で、送信は利用者のメールアプリが行う。
  Appleの任意開示の例外は4条件すべてを要し、その1つが「アプリのインターフェース内で利用者が提供する」こと
  （[App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)、2026-11-22確認）。メールアプリは
  アプリのインターフェースではないため例外に当たらないと判断した。外部メール経由のデータについてAppleは明示していないため、
  これは解釈であり、過少申告の審査リスクを避ける保守的な選択。
- [README](README.md) の「現iPhone manifestは収集型未宣言」は古い記述（2026-11-05の `8cc409c` で3型を宣言済み）。
- 未決（候補の `unresolved` より）：Cloudflareのログ・IP・診断の保持、D1 Time Travel、サポートの保持範囲、
  App Attest登録・監査記録の保持、最終archiveのPrivacy Report。いずれも運営者・法務の判断。
- Watch appのmanifestは収集型を宣言していない（Watchは申請を送らない）。

## 7. G23 テキスト申請規約（#124）

**運営者の選択（2026-11-22）：Q1 A、Q2 条件付きA、Q3 提案どおり**（[OWNER_CHOICES.md](../../../legal/v1-text-reports/OWNER_CHOICES.md)）。
**G23は正式承認済みではない。** 90日最小化・保存期間・削除対応の実態と規約の整合性が確認できるまで承認しない（運営者条件）。

規約候補（[REPORT_TERMS_CANDIDATE.md](../../../legal/REPORT_TERMS_CANDIDATE.md)）とコードの照合（2026-11-22、`main` `3749a56`）：

| 規約の記述 | コード | 判定 |
| --- | --- | --- |
| §6 受信後90日を基準に最小化 | `services/api/src/reports/create.ts:13` `REPORT_MINIMIZE_AFTER_DAYS = 90` | 一致 |
| §6 対象：本文、指定位置、確認日、申請者との関連付け、自由記述の施設名・営業時間 | `retention.ts:51-53` が `note`、`proposed_latitude/longitude`、`observed_on`、`submitter_hash`、`claim_host_name`、`claim_hours_note` をNULL化 | 一致 |
| §6 受付ID・分類項目・監査記録・認証登録は別に残る | 上記UPDATEの対象外 | 一致 |
| §6 期限到来だけで完了せず、運営者が実行を管理 | `scheduled.ts` は `REPORT_RETENTION=cleanup` と cron `2-57/5 * * * *` で動くが、`wrangler.jsonc` は全環境 `crons: []` | 文面は一致。**実行は未設定**（P03） |
| §6 残る記録に一律の期限なし、個別に見直す | 実装なし（文面どおり） | 文面は一致。**区分ごとの根拠・期間が未確定**（P01） |
| §8 削除等は窓口で個別対応、アプリ内削除なし | アプリ内削除機能なし | 文面は一致。**請求ケースごとの手順・リハーサルなし**（P02） |

正式承認の前に閉じる必要があるもの（[公開前P0](../../../legal/v1-text-reports/Q2_PUBLICATION_P0.md)）：

- P01 残存記録の区分別の根拠・期間または終了条件
- P02 請求ケースごとの履行手順と非本番リハーサル
- P03 隔離stagingでの実Cron実行証拠（期限前後、複数pass、失敗と再実行、CPU）
- P04 Cloudflare・ログ・サポートの保存先の実態
- P05 文面・Web・RCの最終整合

本番のcron有効化は本番変更のため、別の承認で行う。担当の切り分けは [BACKEND_HANDOFF.md](../../../legal/v1-text-reports/BACKEND_HANDOFF.md)。

## 8. 1.0 (9) で正式規約へ切り替えるための変更（未実施）

手順の正本は [ACTIVATION_DIFF.md](../../../legal/v1-text-reports/ACTIVATION_DIFF.md)。G23の正式承認後にのみ着手する。

| 区分 | 変更 |
| --- | --- |
| 正文 | 承認全文に新version `report-terms.YYYY-MM-DD` を入れ、`scripts/prepare-report-terms.py --document <最終.md> --version <新version>` でhash/pathを得る。`docs/legal/report-terms/<version>.md` に配置。旧draftは不変 |
| iOS | 同一bytesを `apps/apple/MannerPath/MannerPath/Features/Reports/Terms/<version>.md` に追加。`ReportDomain.swift:70` の `ReportTerms.documents` に `Document(version: <新version>, isDraft: false)` を追加 |
| iOS（ビルド） | 16構成の `CURRENT_PROJECT_VERSION` を 8 → 9（Lane 3のレビュー済みPR） |
| API | `services/api/src/reports/community-publication.ts` に承認済みの版・path・hash・URLを記録し、configの `termsVersion` を新版に。iOSの `ReportTerms.documents` と対応させる |
| Web | `site/terms/reports/index.html`（新規）、`site/privacy`・`site/support` の承認済み日英。**Pagesが自動公開するため、Web公開の許可までmergeしない** |
| 検証 | `make contract`、`make api-validate`、`make apple-validate`、`scripts/run-iphone-ui-tests.sh`、新版の同一bytes/hash・旧版拒否と更新案内・非遡及の対象テスト、配布署名後の `apple-beta-preflight.sh` |
| 切替 | 承認済みアプリ・公開URL・サーバー版を同時に切り替える。片方だけ先行しない。本番デプロイ・受付開始は別の承認 |
