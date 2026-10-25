# 金沢市周辺の公式喫煙場所調査 — Lane 4 / 2026-10-25

**公開可能0件。存在の一次記載を確認した保留候補2件、駅東西の未確認候補2件。富樫周辺の採用0件。**
調査・候補メタデータ・オフラインonboardingまで。権利承認、source registry登録、adapter/fixture追加、D1操作、promotion、本番追加は実施しない。

## 分離と既存調査

- `git fetch origin` 後、origin/main `fe8bda6` から `/private/tmp/mannerpath-kanazawa-official` に独立worktree、`data/kanazawa-official-smoking-spots` を作成。開始時clean。
- [PR #333](https://github.com/Kounishiyuuki/MannerPath/pull/333) は調査開始時OPEN。変更6ファイルはApp Store提出資料と `scripts/test-store-copy.py`。今回の新規researchファイルとは重複なし。これは対象ファイルの比較であり、他レーンの作業完了を意味しない。mergeしない。
- [10/11再評価](2026-10-11-ishikawa-location-precision-reevaluation.md)、[10/14問い合わせ準備](2026-10-14-kanazawa-official-data-requests.md) を継承。問い合わせは送信しない。以前のrights/current-operation blockerを解除しない。
- 既存の公開地点・タイル・canonical/source ID・registry・manifestには変更なし。今回の `*-research` IDはonboarding内の参照キーのみで、公開IDではない。

## 候補一覧

`unknown` は未確認。全件座標null相当（座標フィールドを作成しない）、locationPrecision=`unknown`。案内図上の位置と再利用可能な座標の精度を分ける。施設中心点、住所、地図ピンを正確な喫煙所位置に変換しない。

| 調査候補 | 一次情報・確認結果 | 位置精度 | 時間・対象・内外・条件 | 権利判断・採用可否 | 未解決事項 |
| --- | --- | --- | --- | --- | --- |
| 金沢駅東口（兼六園口） | [市道路管理課「金沢駅」](https://www4.city.kanazawa.lg.jp/soshikikarasagasu/dorokanrika/gyomuannai/30/28323.html) は喫煙所利用を案内。[東広場PDF](https://www4.city.kanazawa.lg.jp/material/files/group/78/kanazawaekipdf1.pdf) 1頁を目視したが喫煙所の明示を確認できず | unknown。木ノ新保町2番地は広場の所在地で喫煙所の住所ではない | 喫煙所固有の時間・対象・内外・料金/乗車券条件すべてunknown。24時間・無料とはしない | 市の表現転載制限あり。権利未承認。地点の一次証言不足のため採用不可・blocked | 市による東口の喫煙所特定、管理範囲、現行運用、再利用可能な位置根拠 |
| 金沢駅西口（金沢港口） | 同じ[市ページ](https://www4.city.kanazawa.lg.jp/soshikikarasagasu/dorokanrika/gyomuannai/30/28323.html)、[西広場PDF](https://www4.city.kanazawa.lg.jp/material/files/group/78/kanazawaekipdf2.pdf) 1頁。喫煙所の明示を確認できず | unknown。広岡1丁目802番地は広場の所在地 | 時間・対象・内外・料金/乗車券条件すべてunknown | 東口同様。採用不可・blocked | 西口を明示した管理者証言、東口とは独立した位置根拠。駅1点を東西2点に流用しない |
| 金沢城公園・管理事務所近く | [公式FAQ](https://shiro-niwa.pref.ishikawa.lg.jp/kanazawa-castle/info/question.php) に喫煙所の存在記載。[利用上のお願い](https://shiro-niwa.pref.ishikawa.lg.jp/kanazawa-castle/info/request.php) は指定場所以外禁煙。[現行リーフレット入口](https://shiro-niwa.pref.ishikawa.lg.jp/kanazawa-castle/download/leaflet.php) の[日本語ガイドマップ](https://shiro-niwa.pref.ishikawa.lg.jp/kanazawa-castle/_wp/wp-content/uploads/2026/01/f4c27a94991b730588a36dd3b7447b22.pdf) 1頁に管理事務所付近の喫煙場記号を目視確認 | 図上の相対位置は確認。正確な座標はunknown、合法的なanchor未審査。丸の内1番1号は事務所住所で喫煙所住所とはしない | 指定場所でのみ喫煙。喫煙所固有の時間、利用者資格、料金、屋内外はunknown（園内図だけで屋外設備と断定しない）。公園開園時間を転記しない | ページ末尾の無断転載禁止と県サイトポリシーを確認。factReferenceの人間審査候補、承認はしない。保留・blocked | 位置/anchorの権威・再利用審査、入口/経路、喫煙時間、一般利用条件、最新休止/移設の確認 |
| 金沢21世紀美術館・広坂口付近の喫煙コーナー | [公式「入館時のお願い」](https://www.kanazawa21.jp/data_list.php?d=1&g=35) の取得HTML本文で館外の広坂口付近を案内。館内全面禁煙。Web抽出では本文が欠落したためHTTP取得本文でも照合 | 入口付近の相対位置のみ。正確な座標unknown、zone/facility anchor未審査 | 館外。喫煙所固有の時間、購入/観覧券要否、料金、一般利用条件unknown。灰皿有無unknownでも、明示された喫煙許可の存在とは分離 | フッター権利留保。専用利用規約の網羅確認未了、権利未承認。保留・blocked | [2027-05-06〜2028-03休館予定](https://www.kanazawa21.jp/data_list.php?d=503&g=61) が館外喫煙所へ及ぼす影響、位置根拠、権利・運用審査 |

全件、煙草種類、屋根、バリアフリー、`openNow`はunknown。灰皿だけで許可や一般公開を推定しない。城と美術館は「現ページが喫煙場所を案内する」という調査結果であり、現地確認済み・承認済みとはしない。

## 富樫周辺の調査境界と除外

- `金沢 富樫 喫煙所 公式`、`site:www4.city.kanazawa.lg.jp "富樫" "喫煙所"`、`site:www4.city.kanazawa.lg.jp "富樫" "禁煙"`、スポーツ事業団の富樫/喫煙検索を実施。地点として確認できる公式資料を発見できず。不存在・地域全域禁煙という結論ではない。
- [教育プラザ富樫の施設案内PDF](https://www4.city.kanazawa.lg.jp/material/files/group/93/202305_guide_color.pdf) に全館禁煙の記載（検索索引）。喫煙候補に採用しない。この記載から近隣屋外の許可/禁止まで広げない。
- [金沢市スポーツ事業団FAQ](https://www.kanazawa-sports.jp/use/qa/) は指定喫煙コーナー利用という総論。施設別位置を示さず、総合体育館等に存在する証拠にはしない。総合体育館の個別ページはWeb取得503、利用規約も取得できず、施設別候補は作成しない。
- CLUB JT等の第三者サービスは検索に出現したが、名称・座標・時間・利用条件のコピーやcanonical provenanceには使用しない。駅東西の第三者記事には相互不一致もあり、左右案内や24時間情報を採用しない。
- 百番街館内の以前の矛盾、フォーラスの情報利用禁止、JRの権利blockerは今回解除しない。優先地域以外への網羅調査はしない。

## 権利・出典の審査引継ぎ

これは許諾・法的判断ではなく、未承認の工学的調査メモ。ライセンス名や承認者を捏造しない。

| 出版者・適用範囲 | 読んだ条件 | 今回の扱い |
| --- | --- | --- |
| 金沢市のページ/PDF | [リンク・著作権](https://www4.city.kanazawa.lg.jp/11790.html) 著作権節。引用等の例外以外の複製/転用は制限され、担当課への使用許諾確認を案内。リンクは原則自由 | オープンライセンスとはしない。正規化した事実参照がADR-0018に適合するか人間審査が必要。従前のrightsBlockedを維持 |
| 金沢城公園ページ/図 | FAQ/リーフレット末尾は文章・写真等の無断転載禁止。[県サイトポリシー](https://www.pref.ishikawa.lg.jp/about_site/sitepolicy/index.html) 著作権節も複製/転用制限 | 表現の転載制限と情報利用禁止を区別して引継ぐ。別ホストの県ポリシーだけで個別図面の利用許可とはしない。未承認 |
| 金沢21世紀美術館ページ | 取得HTML末尾にCopyright / All right reserved。専用条項の確認は未完了 | 権利状態unreviewed。factReference適否は人間審査へ |

出典表記案は各候補の `attributionMetadata` に出版者・資料名・確認日を記録し、表示時に一次URLを併記する想定。これは出版者指定の表記でも許可でもない。図面、スクリーンショット、ロゴ、記事全文、第三者データをrepoへ収録しない。HTTP取得のURL・status・SHA-256・UTC取得時刻のみ[fetch ledger](2026-10-25-kanazawa-fetch-ledger.json)へ保存。原文は一時領域のみ。取得時刻は現地観測時刻/lastVerifiedAtに代入しない。

## 既存パイプラインへの接続

[onboarding入力](nationwide-discovery/2026-10-25-kanazawa-onboarding-input.json) は既存 `source-onboarding.ts` schemaを使用。4件とも `publicationStatus: blocked`、`review.approvalGate: {}`、座標unknown。人間承認者・商用再利用可・現行運用承認などは設定しない。城/美術館の明示事実は上表に残し、未承認メタデータを承認シグナルに変換しない。

生成した4つのreview packetは同ディレクトリの `2026-10-25-kanazawa-*-review.json` と付随Markdown。既存公開ソースを混ぜないよう各研究IDで絞った。全件BLOCKED、productionApproval=false。quality/promotionはnotEvaluatedであり、データ品質ゲート合格ではない。権利/位置/存在/運用の独立審査を維持する。

## 本番追加前後の検証手順（実行は別途許可された作業）

1. 追加前：mainと他PRの状態を再確認し、既存公開ID・地点数・source release・tile snapshot/ETagの読み取り基準値を、権限のある担当者が保存する。既存源と候補の重複/移設をレビューし、既存ID変更0・既存地点削除0を要件にする。
2. 一次ページの現行性、閉鎖/移設/工事の矛盾、時間と利用対象を再確認。権利担当者が資料単位でfactReferenceまたは許諾を審査し、出典・再利用範囲を確定。明示的な情報利用禁止はfail closed。富樫や駅で地点未確認なら保留を維持する。
3. 位置担当者が出版社座標またはADR-0018の合法的なapproximate anchorを審査。案内図の画素、手置きピン、Google/Apple/OSMから座標を作らない。施設anchorを使うならareaApproximate/facility。同じanchorの複数zoneを複製せず1施設1点にする。
4. 承認後の別PRで初めてimmutable fact fixture、PROVENANCE、registry、adapter、回帰テストを追加。freshなローカル環境でsource限定取込、quality、重複/移設/権利/位置/出典/未知値/holdの検査。今回のonboarding出力を取込fixtureとして使わない。
5. promotion/D1/本番追加は明示許可がある別作業のみ。適用前に追加分のみであること、既存IDの不変性、承認ソースのみであることを検証。本番前後の検証を理由に今回promotionを実行しない。
6. 追加後：担当者がAPI/タイル/詳細の件数・ID・出典・approximate表示・時間unknown・アクセス制限を照合。既存地点/タイル/IDの予期しない差分があれば公開を停止し既存hold/復旧手順で対応。継続的なsource healthと美術館休館前の再確認を設定する。

## ローカル検証

D1/取込/タイル生成/promotionは対象外。コード・services配下の変更なしのため `make api-validate` は実施せず、入力を処理する既存CLIと対象テストを検証した。

- Node 24.22.1を一時npm cache経由で使用。システムNodeは23.3.0のため未使用。`npm ci --ignore-scripts --cache /private/tmp/kanazawa-npm-cache` 成功、lockfile変更なし。既存依存のaudit表示はmoderate 2 / high 2件。依存更新は対象外。
- `source:onboarding` を各research IDで4回実行し、4件のJSON/Markdown生成に成功。実行形式：`node --experimental-strip-types --no-warnings scripts/source-onboarding.ts <research-id> --metadata ../../docs/research/nationwide-discovery/2026-10-25-kanazawa-onboarding-input.json --out ../../docs/research/nationwide-discovery/2026-10-25-kanazawa-<label>-review.json`（services/api、Node 24）。CLIは既存ファイルを上書きしないので再実行時はfreshな一時出力先を選ぶ。
- `node --experimental-strip-types --experimental-sqlite --no-warnings --test test/source-onboarding.test.ts`：18/18 PASS。
- `make contract`：PASS（4+57+7+6+4+11件の契約テスト）。
- Pythonで入力4IDと4生成packetの一致、BLOCKED、承認false、座標unknown/列なし、権利要審査、registry/adapter/fixtureなし、quality/promotion未評価を検査：PASS。ledger 10件がHTTP 200・64桁SHA-256を持つこともPASS。
- 駅東西PDF各1頁、城ガイドマップの地図をPDFKitでPNG化し目視確認。図像はrepoに含めず座標抽出なし。
- `git diff --check`：PASS。新規research資料のみで、承認registry/公開データ/コード差分なし。
- read-only reviewerによる権利・位置・公開境界レビュー：重大指摘なし。現地確認・網羅的な休廃止調査・権利承認・実データ品質/promotionは未実施。CI結果はPRで確認する。
