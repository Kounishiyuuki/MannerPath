# 暫定RC 1.0 (8) の提出素材準備（2026-11-22）

**SUBMISSION: BLOCKED のまま。** この文書は準備の照合結果で、承認・ASC転記・本番操作は行っていない。
ゲートは [canonical Gate](../../../V1_APP_STORE_RELEASE_GATE.md) のとおり全項目OPEN。

- 暫定RC：1.0 (8)（運営者決定 2026-11-22）。アプリのソースは `main` `159bee8` から `3749a56` まで `apps/` に差分なし
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

注意：最近傍距離の最小が0 mの組がある（同一地点に2件）。重複か、別施設の同一座標かは未確認。
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

- manifestと候補はアプリ内収集の3型で一致する。Customer Support／Email AddressはアプリのUI外（メール）での取得のため
  manifestにはなく、ASCでの申告要否は運営者が判断する。
- [README](README.md) の「現iPhone manifestは収集型未宣言」は古い記述（2026-11-05の `8cc409c` で3型を宣言済み）。
- 未決（候補の `unresolved` より）：Cloudflareのログ・IP・診断の保持、D1 Time Travel、サポートの保持範囲、
  App Attest登録・監査記録の保持、最終archiveのPrivacy Report。いずれも運営者・法務の判断。
- Watch appのmanifestは収集型を宣言していない（Watchは申請を送らない）。
