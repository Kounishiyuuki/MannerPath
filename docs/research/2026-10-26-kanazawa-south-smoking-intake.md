# 金沢南部・富樫周辺の喫煙設備候補 — Lane 4 / 2026-10-26

**28施設を調査、設備記載確認12施設（独自運営者9・利用制限のある店舗更新ページ3）。実候補6行を既存source:intakeへ受付。正式取込可能0件・新規公開0件。**
設備候補20件の目標には未達。調査対象・未確認・禁煙施設を喫煙候補数へ加算しない。
既存の駅東西・21世紀美術館・金沢城4候補とは別施設で、既存データを上書きしない。

## 開発と成果物

`git fetch origin`後、最新origin/main `3b5fd60`（#342統合済み）から独立worktree
`/private/tmp/mannerpath-kanazawa-south`、ブランチ `data/kanazawa-south-smoking-intake` を作成。開始時clean。

- [manifest](../../services/data-pipeline/research/official-source-intake/kanazawa-south/manifest.json)：6施設の正規化実入力、出版者別receipt、生成intake。単なるURL一覧ではなく場所・設備・unknown条件・出典の実レコード。
- [PROVENANCE](../../services/data-pipeline/research/official-source-intake/kanazawa-south/PROVENANCE.md)：取得証跡、権利/位置の独立審査、実ABR結果と失敗理由。
- [survey](../../services/data-pipeline/research/official-source-intake/kanazawa-south/survey.json)：28施設の判定と次の確認事項。
- [未送信文案](../../services/data-pipeline/research/official-source-intake/kanazawa-south/INQUIRY_DRAFT.md)：最優先のサンマルコと6施設に対する具体的な確認項目。
- address-anchor.ts：実取得した金沢/野々市ABR releaseをappend登録。既存Tokyo release・許容precision・ゲートは変更なし。
- [回帰テスト](../../services/api/test/kanazawa-south-intake.test.ts)：実データ受付、全件のprecision拒否、ソース未承認、既存ID/全タイル状態不変。

## 地点別一覧

「設備確認」はページでの記載確認であり、現地確認・一般公開・権利承認ではない。P-WORLD等の情報利用制限を持つページは
調査判断だけを保持し、設備値・住所・時間・座標等を掲載用fixtureへ転写しない。表中P-WORLDのユーザー提示URLは参照文字列として残し、公開用の出典リンクやデータ源にしない。

| 施設・地域 | 一次情報の参照 | 判定・不足事項 |
| --- | --- | --- |
| サンマルコ（円光寺） | `https://www.p-world.co.jp/ishikawa/sanmarco.htm` | 店舗更新の記載確認・利用制限により取込不可。店舗更新ページの設備記載を最初に確認。P-WORLDの情報利用制限によりデータ取込せず。次：店舗が直接提供する設備・位置情報と再利用許可 |
| DSGアリーナ（野々市本町） | [公式ページ](https://www.dsg-group.jp/business/store/) | 未確認。独自サイトに店舗はあるが設備記載を確認できず。提供P-WORLD URLは追加抽出しない。次：運営者による独立した設備・位置情報 |
| オメガ野々市ホワイトバード（野々市） | `https://www.p-world.co.jp/ishikawa/omega-p1.htm` | 店舗更新の記載確認・利用制限により取込不可。ユーザー提示の店舗更新ページを確認後、利用制限のため取込せず。次：独立した運営者設備情報と位置・再利用根拠 |
| ホームランGOGO野々市店（野々市横宮） | [公式ページ](https://homerun.co.jp/shop_nonoichi.html) | 独自一次で設備確認・未承認。独自運営者サイトに喫煙ブース。実データ受付対象。次：適格な施設anchor・source別権利審査 |
| KEIZラパーク金沢店（西泉） | [公式ページ](https://www.heiseikankou.com/shop/store_19.html) | 店舗更新の記載確認・利用制限により取込不可。独自ページに設備を確認できず。P-WORLD記載は取込せず。次：独立した運営者設備情報と位置・再利用根拠 |
| 倉式珈琲店 御経塚店（野々市御経塚） | [公式ページ](https://www.saint-marc-hd.com/kurashiki/shop/19/) | 独自一次で設備確認・未承認。店舗固有サービスに喫煙ブース・客席禁煙。受付対象。次：適格な施設anchor・source別権利審査 |
| 飛行船 工大前店（野々市扇が丘） | [公式ページ](https://hikaricorp.jp/karaoke/koudaimae.html) | 独自一次で設備確認・未承認。店舗本文に喫煙ブース・客室禁煙。受付対象。次：適格な施設anchor・source別権利審査 |
| しあわせの湯（野々市横宮） | [公式ページ](https://shiawasenoyu.co.jp/info.html) | 独自一次で設備確認・未承認。FAQに2階喫煙室。受付対象。次：適格な施設anchor・source別権利審査 |
| 福々亭（横川） | [公式ページ](https://dskgroup.co.jp/shop/jp1117/) | 独自一次で設備確認・未承認。運営者本文は店外喫煙場所を明示。直接HTTP403のため再取得せず保留。次：公開pageの取得証跡・権利審査・施設anchor |
| 満天の湯・道の宿 白山インター（野々市柳町） | [公式ページ](https://www.manten-hotel.com/michinoyado-1/room/) | 独自一次で設備確認・未承認。1階と客室階の喫煙ルーム。同一施設1候補。受付対象。次：適格な施設anchor・権利審査・客室階アクセス条件 |
| 快活CLUB 金沢久安店（久安） | [公式ページ](https://www.kaikatsu.jp/shop/detail/20413.html) | 独自一次で設備確認・未承認。現行店ページと全店喫煙室FAQを確認。規約適用未解決のため取込保留。次：会員規約13条の情報利用制限の適用範囲・位置根拠 |
| コート・ダジュール野々市矢作店（野々市矢作） | [公式ページ](https://www.cotedazur.jp/branch/detail/10341.html) | 未確認。運営者ページに設備記載を確認できず。次：現在の運営者証言 |
| ミスタードーナツ野々市ショップ（野々市本町） | [公式ページ](https://md.mapion.co.jp/b/misterdonut_s/info/0161/) | 未確認。選択アイコンは全席禁煙。下部の喫煙ブース凡例は存在証拠にしない。次：店舗固有の設備証言 |
| タリーズ金沢野々市店（野々市） | [公式ページ](https://shop.tullys.co.jp/) | 未確認。個別公式店情報の取得不十分。古い口コミは採用せず。次：現行の店舗固有案内 |
| カエデ珈琲（野々市） | [公式ページ](https://www.e-maplehouse.com/contents/shop/maple_kaedeCoffee.html) | 未確認。旧メニューの席喫煙表記を現行許可に転用せず。次：現行設備と席喫煙条件の確認 |
| 星乃珈琲店 金沢押野店（野々市押野） | [公式ページ](https://www.hoshinocoffee.com/shop.html) | 独自一次で設備確認・未承認。石川県の店舗固有行に喫煙ブース。受付対象。次：適格な施設anchor・source別権利審査 |
| ゆず庵 金沢有松店（有松） | [公式ページ](https://www.shabu-yuzuan.jp/shop/4131/) | 独自一次で設備確認・未承認。設備記載は確認。運営者の情報利用制限により取込せず。次：利用規約の許可・適用範囲確認、位置根拠 |
| ラウンドワンスタジアム金沢店（横川） | [公式ページ](https://www.round1.co.jp/shop/tenpo/ishikawa-kanazawa.html) | 未確認。現行店舗とFAQに設備記載を確認できず。次：店舗固有の設備証言 |
| ビリオン珈琲 久安店（久安） | [公式ページ](https://www.legacyhd.co.jp/products_birioncoffee.html) | 未確認。独自店舗一覧を確認、喫煙設備の本文根拠なし。次：運営者の設備案内 |
| CHANOMI 富樫本店（富樫） | [公式ページ](https://www.cha-nomi.com/togashi/) | 未確認。店舗は確認、喫煙場所の明示なし。次：運営者の設備案内 |
| ふくふくパンチャンの家（山科） | [公式ページ](https://www.panchan.co.jp/) | 未確認。焼肉用吸煙ダクトを喫煙許可に転用しない。次：運営者による喫煙可否・専用場所の証言 |
| ヤギヤ（寺地） | [公式ページ](https://yagi-ya.com/) | 未確認。店舗は確認、喫煙場所の明示なし。次：運営者の設備案内 |
| すし食いねぇ！金沢寺地店（寺地） | [公式ページ](https://www.sushikuine.co.jp/shops/terazi/) | 未確認。第三者の屋外スペース記載を運営者ページで裏付けできず。次：運営者の設備案内 |
| 金沢市総合体育館（泉野出町） | [公式ページ](https://www.kanazawa-sports.jp/use/search/433/) | 除外（禁煙/廃止）。2019-06-30喫煙場所廃止・敷地内に喫煙場所なし。次：採用しない |
| 金沢南総合運動公園（富樫周辺） | [公式ページ](https://www.kanazawa-sports.jp/no_smoking/) | 除外（禁煙/廃止）。敷地内禁煙対象。旧一般FAQから指定場所を推定しない。次：採用しない |
| 久安運動広場（久安） | [公式ページ](https://www.kanazawa-sports.jp/no_smoking/) | 除外（禁煙/廃止）。敷地内禁煙対象。次：採用しない |
| 伏見川スポーツ公園（南部） | [公式ページ](https://www.kanazawa-sports.jp/no_smoking/) | 除外（禁煙/廃止）。敷地内禁煙対象。次：採用しない |
| コメダ珈琲店 野々市矢作店（野々市矢作） | [公式ページ](https://kagaworks.co.jp/business/biz03/) | 未確認。現行独自店舗案内に設備根拠なし。旧分煙情報を採用せず。次：現行の店舗固有設備証言 |

富樫本体・泉野・寺地・山科の調査から、根拠のない店舗や廃止された公共施設を作成しない。焼肉の吸煙ダクト、灰皿、
一般的な施設カテゴリ、サイト共通アイコン凡例、古い分煙情報は存在証拠にしない。横川の福々亭は屋外場所、その他の専用室/ブースと
席喫煙を分けた。今回、再利用可能で現行の席喫煙地点は確認できていない。

## 最優先サンマルコと権利ゲート

サンマルコのユーザー提示ページを最初に確認し、店舗更新ページに屋内喫煙室の記載があった。
しかしP-WORLDの総合規約第8条は許可なしのデータ収集・情報の二次利用を禁止し、著作権/免責ページも業務利用を制限する。
店舗自身が更新することと、ホスティング側の権利が再利用可能なことを混同しない。正規化データへの転写・クロール・DB複製は行わず、
追加取得を止めた。サンマルコの解消方法は、店舗から独立して提供された必要な事実と再利用許諾、位置の根拠を得ること。
問い合わせ文案は用意したが送信しない。独立出典が得られるまではP-WORLDの情報をfactReferenceとして登録しない。

ホームランは独自運営者サイトにも喫煙ブースの記載があるので、その独立ページからのみ候補を作った。
ゆず庵/快活CLUBの情報利用条項も未解決で受付保留。福々亭は直接HTTP403後の取得を止め、裏口や別endpointで回避していない。
CLUB JT・OSMのデータ取得/転載は行わず、いずれもcanonical provenanceにはしない。

6受付施設のフッター/関連規約は別に読み、情報利用禁止と表現の転載制限を分けたが、source別承認・G5は未完了。
ライセンスや承認者を作らず、全件BLOCKED。権利条件が整っても位置根拠の失敗を解除しない。

## 実際に位置根拠を取得・評価した結果

公式住所をabr-geocoder2.3.1へ入力し、金沢172014・野々市172120の公的データを新規取得した。
既定並列downloadのSQLITE_BUSYは、同じCLIのsupported `-t 1` とfreshディレクトリで解消（ツール改変なし）。
取得した15 ZIPの名前順SHA-256 manifestを固定した。releaseは
`abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d`。

| 施設 | 実ABR coordinate_level | 正式掲載への不足 |
| --- | --- | --- |
| ホームランGOGO野々市 | parcel | 適格な施設代表点＋source権利審査。未一致の番地残余もあり |
| しあわせの湯 | parcel | 適格な施設代表点＋source権利審査。2階の利用条件確認 |
| 飛行船工大前 | machiaza | 適格な施設代表点＋source権利審査。町字点を施設点にしない |
| 倉式御経塚 | parcel | 適格な施設代表点＋source権利審査 |
| 星乃金沢押野 | machiaza_detail（matchはparcel） | 適格な施設代表点＋source権利審査。一致水準と座標水準の乖離あり |
| 満天の湯・道の宿 | parcel | 適格な施設代表点＋source権利審査。1階/客室階の利用資格確認 |

既存ゲートが認めるresidential_detail/blockは**0件**。explicit residential targetでの別の実行も町字水準に戻り、救済できなかった。
[anchor-review.json](../../services/data-pipeline/research/official-source-intake/kanazawa-south/anchor-review.json) は実ZIP digest/件数検証後の生成物で、
全6件にprecisionTooLow、3件にunmatchedRemainder、1件にcoordinateCoarserThanMatch。
parcelや町字点をareaApproximateへ昇格せず、候補の位置はunknownのまま。将来合法的な施設代表点を得た場合も、
`areaApproximate/facility` として扱い、喫煙室や入口の正確なピンにしない。

政府host pointの代替も確認したが、市の観光CSV8件・AED CSV59件・公式CKAN tourismに対象6施設はなかった。
近隣の別POIやAEDへ位置を寄せない。地図画素・Google/MapKit/OSM値・手置き点は不使用。
必要な次の資料は、施設自身が意味と再利用条件を明示する数値代表点、または正当な公的host reference point。
新しい位置ポリシーを勝手に採用して件数を増やさない。

## 件数と移行段階

| 指標 | 件数 |
| --- | ---: |
| 調査対象の施設 | 28 |
| 設備記載確認候補 | 12（独自一次9、利用制限ページ3） |
| 未承認の設備候補 | 12 |
| その他、設備未確認 | 12 |
| 禁煙/廃止で除外 | 4 |
| 既存source:intakeで受け付けた実候補行 | 6 |
| 正式取込可能 / accepted observations / canonical追加 / 新規公開 | 0 / 0 / 0 / 0 |

目標20設備候補に対して不足8。未確認施設・禁煙施設を加算して達成したようには報告しない。
設備のない施設に行く誤案内を防ぎ、次の担当者が具体的な位置/許諾照会から再開できる実レコードを残した。
適格な位置が0のため、正式adapter/fixture/approved registryは追加しない。
既存金沢4候補との名前・運営者URL・住所の重複はなく、統合/ID移設処理は行っていない。

## 検証

- `source:intake` 6回：成功。全6行BLOCKED、rights/coordinate/current-operation要審査。生成結果と入力digestをテストで照合。
- 実datasetを使う `address:anchors evaluate ... --dataset ... --release ...`：正常実行、anchor採用0、全件保留。
- `kanazawa-south-intake.test.ts`：3/3 PASS。原文住所の表記確認後の再geocode/再生成でも再検証。
- `make contract`：PASS。
- `make api-validate`：PASS（typecheck、API1381/1381、discovery102/102）。既存品質・権利・位置精度・ID保持テストを含む。
- `git diff --check`：PASS。CI結果はPR本文に記録。
- Node24を既存一時npm cache経由で使用。geocoderは既存技術審査済み2.3.1/Node23。production依存とlockfileは変更なし。

既存fixture corpusを構成してID・tile本文・hash・revision・parts・membershipの完全一致を確認した。
本番を読み取った/本番IDを検証したという意味ではない。本番D1、Cloudflare、promotionコマンド、問い合わせ送信は実施せず、mainへmergeしない。
