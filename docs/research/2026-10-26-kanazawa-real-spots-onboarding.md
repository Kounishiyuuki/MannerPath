# 金沢4地点の実候補データ投入 — 2026-10-26 / Lane 4

**実候補4行を作成し、既存source:intakeで2+1+1行の受付を完了。正式なcanonical取込0件、公開可能0件。**
URL調査だけの成果物から、正規化した地点別入力と再現可能な受付・未承認ゲートのテストへ進めた。
権利承認と位置の権威が未確定のため、公開可能との判定はしない。条件が整った地点は今回の調査では0件。

## 準備と変更範囲

- `git fetch origin` 成功。最新origin/main `4e2cca5` から独立worktree
  `/private/tmp/mannerpath-kanazawa-real-spots`、指定ブランチ `data/kanazawa-real-spots-onboarding` を作成。開始時clean。
- [PR #339](https://github.com/Kounishiyuuki/MannerPath/pull/339) はMERGED。既存調査・問い合わせ準備・公開前後検証手順は再利用し、過去の調査記録を書き換えない。
- 実入力は [kanazawa/manifest.json](../../services/data-pipeline/research/official-source-intake/kanazawa/manifest.json)。
  出版者別の `*-facts.json`、`*-receipt.json`、生成した `*-intake.json`、fetch ledger、PROVENANCE、未送信の問い合わせ文案を追加。
- [回帰テスト](../../services/api/test/kanazawa-intake.test.ts)を追加。productionコード・registry・adapter一覧・既存fixture・公開ID・タイル・G5判定は変更しない。

## 4地点の判定

| 候補・一次情報 | 採用可否 | 位置精度 | 権利・残る具体的な障害 | 解消方法 |
| --- | --- | --- | --- | --- |
| 金沢駅西口・金沢かつぞう側入口付近：[百番街案内](https://www.100bangai.co.jp/info/index.php) | 審査入力可、公開不可 | unknown、座標null | 百番街の隣接場所紹介として保持。管理主体の証言/現行区画、source固有rights review、再利用できるzone anchorが未確定 | 百番街→設置管理者/市道路管理課へ未送信文案で確認。公式座標か正当な独立zone anchorを入手し審査 |
| 金沢駅東口・石川県立音楽堂の向かい：[同案内](https://www.100bangai.co.jp/info/index.php) | 審査入力可、公開不可 | unknown、座標null | 西口と同様。駅代表点を東西2点として使えない | 管理者と東口区画を確認し、東口専用位置根拠を審査。施設代表点しかなければ同施設の1点へ集約 |
| 金沢21世紀美術館・館外広坂口周辺：[美術館案内](https://www.kanazawa21.jp/data_list.php?d=1&g=35) | 審査入力可、公開不可 | **areaApproximate / facilityの未審査提案**。金沢市観光施設データ代表点 `36.560867, 136.658258`。喫煙所の正確な座標はnull | source固有factReference review、独立anchorの原条件/CRS/権威と登録が未確定。2027-05-06〜2028-03予定の休館の館外への影響不明 | 出典別権利審査・city anchor登録・座標意味/CRS確認。休館時運用を施設へ確認。承認後も正確なピンに変更しない |
| 金沢城公園・管理事務所周辺：[県公式FAQ](https://shiro-niwa.pref.ishikawa.lg.jp/kanazawa-castle/info/question.php) | 審査入力可、公開不可 | 図上の相対位置のみ、pipeline precision unknown、座標null | source固有factReference review、正当な公園/施設anchorが未確定。事務所住所だけから座標を作らない | 管理事務所に区画/入口/座標系付き座標・独立アンカー資料を照会し審査 |

4地点とも喫煙所固有の時間、一般/顧客/乗車券等の利用条件、紙巻き・加熱式はunknown。灰皿有無も推定しない。
unknownを許可・禁止・24時間・営業中へ変換しない。未知の利用条件だけで存在を否定する追加ゲートも作らない。
館外案内と設備が屋外開放式であることは別なので `placement=outsideBuilding` と `environment=unknown` を分けた。

百番街FAQの館内案内との従前の差異は残し、今回の館外2地点とは分離した。URL指定を変えると抽出できる範囲が
異なる場合があるため、実取得HTMLでも該当事実を確認した。城と美術館は管理施設の直接案内、駅は隣接施設からの
紹介と識別する。事実の掲載を確認したことと、accepted existence evidenceの承認は区別する。

## 新たに保存した位置根拠・権利の扱い

美術館の施設代表点は [金沢市観光施設一覧](https://catalog-data.city.kanazawa.ishikawa.jp/dataset/172014-tourism/resource/51a0ab9e-e702-40c2-bc0e-1c5ce1da4e66)
の公的データから取得。ID `AA0000001260`、緯度・経度列、取得API、レスポンスSHA-256、scope/basis、出典案を
候補内に保存した。CRS未確認・権利未承認のため、`locationAnchorCandidate.reviewStatus=UNREVIEWED`。
accepted pipeline座標はunknownのままで、anchor tableには登録しない。

市カタログのCC BY表示だけを承認根拠にせず、[原利用規約](https://portal-data.city.kanazawa.ishikawa.jp/pdf/opendata_rule.pdf)
§2のデータ別ライセンス、数値データ、出典/加工表示、第三者権利の条件を審査用に記録した。
一般の市ホームページの著作権制限と、この独立データの条件を混同しない。
3つの存在ページは著作権留保/転載制限があるため、ADR-0018の事実参照に適合するかsource別審査を残す。
rawページ・画像・図面・文章は配布せず、必要な正規化事実・出典・日付・digestのみを保持する。

G5は出荷corpusの権利sign-off・署名実機の出典表示検証を含み、単なるfactReference分類やローカルテストでは閉じない。
権利承認者を捏造せず、法的承認・権利承認を代行しない。詳しい適用範囲と未知値は
[PROVENANCE.md](../../services/data-pipeline/research/official-source-intake/kanazawa/PROVENANCE.md)、
解消のための未送信文案は [INQUIRY_DRAFTS.md](../../services/data-pipeline/research/official-source-intake/kanazawa/INQUIRY_DRAFTS.md)。

## 実際のローカル取込件数

| 段階 | 件数 | 意味 |
| --- | --- | --- |
| 正規化した地点入力 | 4 | 3出版者のJSONに地点単位の事実とunknownを保存 |
| 正式source:intake受付 | 4 | 3回のCLIでrawRowCount=2/1/1。digest固定・重複/欠損の検査。人間審査必須、全件BLOCKED |
| テスト専用blocked raw staging | 4 | 実候補を既存ingestReleaseで隔離in-memory SQLiteのsource_recordsへ格納。再取込で重複0 |
| accepted source observations / canonical追加 | 0 / 0 | 未審査ソースの正式登録を拒否。テストadapterもobserve/resolveを拒否し、偽座標を作らない |
| 今回の新規公開 / 公開可能 | 0 / 0 | registry・rights・anchor未審査のまま。raw staging件数を正式公開取込と誤称しない |

テスト専用blocked stagingは本番用インポータではない。未知の数値座標を要求するSourceObservationへnull/0で進めず、
既存承認データと同じsource IDを借りて通すこともしない。権利/位置承認後にsource-specific adapterを追加する必要がある。

既存Taito corpusをローカルで構成し、候補4件の受付・raw staging・resolve拒否・再publishの前後で全spots行、tile snapshots、
parts、membershipを完全一致検証する。ID・revision・content hash・body bytesの差分0をテストで確認する。
これは隔離されたfixture corpusでの確認であり、本番データを読み取った/検証したという意味ではない。

## 富樫の継続調査

市公式/施設管理者に限定した富樫・喫煙所検索を継続。[市営球技場](https://www.kanazawa-sports.jp/use/search/686/)
（富樫3丁目8番10号）の公式使用上の注意には敷地内禁煙と敷地外で周囲への迷惑となる喫煙を控える旨がある。
ここから喫煙候補を作らない。一般FAQの指定喫煙コーナーという総論を富樫の個別施設へ転用しない。
その他の一次証言を確認できなかったため追加0件。不在証明や富樫全域禁煙の宣言ではない。

## 再現コマンドと検証結果

Node >=24、services/apiで `npm ci --ignore-scripts`。今回Node 24.22.1と一時npm cacheを使用した。
既存依存audit表示はmoderate 2 / high 2。依存更新・lock変更なし。
source:intakeはPROVENANCE記載のコマンドをstation/museum/castleに対して実行。出力先はfreshなpathを指定する。

- source:intake 3回：成功、4行受付・すべてBLOCKED。生成 `*-intake.json` とmanifestのSHA-256一致。
- `node --experimental-strip-types --experimental-sqlite --no-warnings --test test/kanazawa-intake.test.ts`：4/4 PASS。
- `npm run typecheck`：PASS。
- `make contract`：PASS。
- `make api-validate`：PASS。typecheck、API 1378/1378、discovery 102/102。既存のデータ品質・権利・位置/areaApproximate・promotion/ID保持テストを含む。
- `git diff --check`：PASS。read-only最終レビュー：指摘なし。CI結果はPRに記録する。

全体API検証には既存intake、権利、areaApproximate、データ品質、ID保持・promotionの回帰テストが含まれる。
テストでのローカルpublication/promotion検査は本番追加ではなく、今回の4候補の品質/権利承認成功でもない。
Cloudflare、production D1、本番promotion、外部問い合わせ送信は実施しない。mainへのmergeは禁止のまま。

補足：受付scannerの`coordinateAvailability=all`は列名ベースのadvisory信号で、この入力ではnullの緯度経度列も検出する。正確な座標が存在するという判定ではない。各候補のexact座標はnull、onboardingの座標権威は全件unknown/要審査のままで、回帰テストもこの境界を検証する。富樫球技場ページはWeb本文で確認できたが直接HTTP取得は503だったため、ledgerに成功digestを捏造していない。
