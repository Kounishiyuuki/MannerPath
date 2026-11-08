# 金沢・野々市 地番3施設の掲載データ準備

調査開始main: `4c6d701c59df08610bb09dd1e1f1a3fa1e6b09fe`。提出基準main: `fe339eb`（#409統合後）。確認日2026-11-08 UTC/JST。
対象は倉式珈琲店 御経塚店、満天の湯・道の宿 白山インター店、金沢国際ホテルのみ。
本PRは正規化した候補データと審査証跡の準備であり、運営者の正式承認・source登録・本番掲載ではない。
本番・staging・規約公開・main mergeを行わず、既存513地点やKKR、Lane 1のホテル群を変更しない。

## mainと他Laneとの境界

- PR #403は未mergeの設計提案であり、採用決定として扱わない。
- PR #407はmainへ統合済み。現行`address-anchor-gate.v3`は、parcelであっても運営者の`PARCEL_TERMS_REVIEW`がない限り`parcelTermsUnreviewed`で拒否する。
- PR #404はmainへ統合済み。KKRホテル金沢を再登録しない。旧案のPR #408にも変更を加えない。
- Lane 3の共通adapter PR #409（HEAD `ae0c739e08e23c447f18ba7889ab7f4951c824f6`）は、準備中にmainへ統合された（merge `533b63f`）。本体をコピー・変更・importしない。候補列から同PRの13列へ移す対応だけを記録する。正式なsource審査・hash再固定・登録は依然必要。

## 成果物と件数の意味

機械可読の正本は[manifest](../../services/data-pipeline/research/official-source-intake/kanazawa-parcel-2026-11-08/manifest.json)。
運営者別にcandidate fact sheet、receipt、adapterなしのintake結果、事実・権利・位置記録を分ける。
候補は3施設・各1行で、同じ施設代表点の複数フロアを複数地点へ増やさない。

- 喫煙設備・公式住所の現行一次情報確認: **3施設**。
- 公式住所の全文によるABR再現: **3施設**。match/coordinate levelともparcel、剰余なし。
- 周辺建物・敷地配置による比較: ホテルと満天は強い整合を確認。倉式は商業区画・前面駐車場付近として整合するが、個別店舗の屋根・入口は同定できていない。
- 現行の実ゲートで採用できたアンカー: **0件**。3件とも正式な地番規約承認が未記録であるため、デフォルト設定で拒否する。
- 本番掲載・公開タイル追加: **0件**。原文を読んだ事実や候補CSVの完成を、正式承認と混同しない。

| 施設 | 現行の公式根拠 | 利用条件と位置の注意 |
| --- | --- | --- |
| 倉式珈琲店 御経塚店 | 店舗固有の有効な「喫煙ブース」表示。全席禁煙とは別設備。公式住所は石川県野々市市御経塚２ー５ | 非利用客の使用、ブース時間、対応たばこは不明。点は商業地の建物列・駐車場付近で、喫煙ブース・入口・特定の屋根位置を断定しない |
| 満天の湯・道の宿 白山インター店 | 現行館内ページの1階大浴場入口手前・客室階2/3/4階。公式住所は石川県野々市市柳町460番地 | 非宿泊客は客室階へ立入不可。1階の非利用客利用は不明。施設名にも一部宿泊者専用を保持。浴場だけの一般利用案内と客室階を混同しない |
| 金沢国際ホテル | 全客室禁煙とは別の館内喫煙コーナー、婚礼ページの宴会フロアの喫煙場所。公式住所は石川県金沢市大額町ル８番地 | 一般無料開放・喫煙固有時間・対応たばこを推定しない。施設複合建物との整合を確認したが、個別区画や入口を示す点ではない |

一次資料:
[倉式公式](https://www.saint-marc-hd.com/kurashiki/shop/19/)、
[満天館内](https://www.manten-hotel.com/michinoyado-1/room/)・[FAQ](https://www.manten-hotel.com/michinoyado-1/faq/)・[住所](https://www.manten-hotel.com/michinoyado-1/access/)、
[国際ホテルFAQ](https://www.kanazawakokusaihotel.co.jp/question/)・[婚礼案内](https://www.kanazawakokusaihotel.co.jp/wedding/guest/)・[住所](https://www.kanazawakokusaihotel.co.jp/access/)。
全施設の原ページを再取得・再読し、既存調査の記述だけを再利用していない。原HTML・画像・PDFはGitへ転載しない。

## 地番利用条件の原文確認

[ABR利用規約](https://www.digital.go.jp/policies/base_registry_address_tos)は、PDLに加え地番マスター・地番マスター位置参照へ登記所備付地図データ利用規約が適用されると明記する。
今回は[公式Tellusデータ詳細](https://www.tellusxdp.com/ja/catalog/data/terrestrial-data/aigid-moj.html)の提供者AIGIDの利用規約リンクを実際にたどり、[原文PDF](https://www.tellusxdp.com/docs/api-service/aigid-moj/tos.pdf)を直接取得した。

- HTTP200、2頁、141,976 bytes、本文の制定日2023-01-23。
- SHA-256 `275914c735b19cc7a274a13aac22e0c08378269d9d80f26f6b285aca32367b99`。
- 取得2026-11-08T05:00:34Z。Last-Modified 2026-10-27は配信更新日時で、制定日・最新版の証明ではない。
- 正本GSpatial・法務省のページは今回403で取得できず、上記の公開原文と現在の正本の完全同一性は**未確認**。アクセス制限の回避はしない。

条項別の工程上の読みは[terms-evidence.json](../../services/data-pipeline/research/official-source-intake/kanazawa-parcel-2026-11-08/terms-evidence.json)に保存する。法的保証・正式承認ではない。

| 項目 | 取得した原文から確認できた条件 |
| --- | --- |
| 商用利用 | 冒頭で明示的に許容 |
| 複製・配信・加工 | 複製・公衆送信・翻案等が許容される。条件を維持する |
| 出典・加工表示 | 法務省の登記所備付地図データ、対象市、URL、利用日等を表示し、加工した旨と主体も示す。国がMannerPath加工版を作成したとの誤認を避ける |
| 再配布 | 複製・公衆送信として可能と読む根拠がある。原文にODbL型のshare-alike義務は見つからない。一部準拠する政府標準利用規約とCC BYを同一視しない |
| 制限 | 法令違反・不正目的・提供妨害・個人情報収集や照合による特定個人の識別・財産/privacy侵害等は禁止。法務省による利用制限の裁量も記載 |
| 精度・責任 | 作成時期・精度の差や無予告の変更・削除、免責がある。測量・筆界・入口・喫煙設備の正確な位置の保証にしない |

数値候補はresearch専用のcandidate列へ記録し、ABR・法務省の出典とMannerPathによる照合・加工を明示する。
研究データの複製・配信の条項確認と、canonical施設アンカー採用の正式承認を分離する。
`PARCEL_TERMS_REVIEW`には承認者・日付・credit等を仮入力せず、**nullを維持**する。試験用の架空承認者を実データへ適用した採用結果も生成しない。

## 位置の妥当性と限界

ABR2.3.1をリポジトリ外で実行し、登録済み金沢・野々市15ZIPの実manifest SHAを再確認した。
施設住所は当該公式資料の全角・長音・番地表記を含む原文を入力し、結果の表記差だけを既存ルールで照合する。
枝番の切捨て、町点の施設点化、別住所の補充、Google/Apple/OSM等のPOI点への置換を行わない。

既存ABR点を[地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)の標準図・航空写真と比較した。
新しい座標の読み取り・生成はしていない。出典は国土地理院、利用条件は[地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)。確認用画像は非公開の作業領域に置き、取得記録と判定だけを残す。
満天では[運営者の駐車場図](https://www.manten-hotel.com/common/images/michinoyado-1/access/map-04.png)と敷地・道路の配置も比較した。
標準図が空地に見える古い表現を、現行施設の閉鎖証拠にしない。

写真による厳密な屋根同定は新しい掲載ゲートにしない一方、住所一致だけで入口や建物内部まで確定したとも扱わない。
全3件で法的な地番範囲・航空写真撮影日は未確認。誤差半径・測量精度を創作しない。
倉式の個別店舗建物は未同定であることを位置記録に残し、施設所在地付近の候補を正確な喫煙所ピンとして見せない。
明確な位置飛び、別施設、立入禁止区画等が後日判明した場合は再審査する。

## 正式採用までの残件

1. 運営者が原規約、正本最新版との同一性未確認という限界、出典・加工表示案を確認して正式に採否を決める。本PRで代行しない。
2. 統合済みの共通adapterの実際の契約を確認し、正式な地番規約承認後にcandidate列をanchor列へ明示変換して、必要な帰属表示を再検証・fixture SHAを再固定する。現在の候補SHAを、そのまま承認済みCSVのSHAと扱わない。
3. source別に権利・現在運用・施設付近という位置の意味を確認し、レビュー済み設定と固定fixtureを登録・テストする。満天の一部宿泊者専用という条件を公開名から落とさない。
4. 既存515 raw/513公開地点を再現する基準データと、既に審査済みの金沢・KKR地点との重複を確認する。通常の独立したpromotion承認なしに本番を更新しない。

候補ファイルは既存source:intakeへadapterなしで通し、shape/hashを検証した結果を保存する。registry、SOURCE_ADAPTERS、SOURCES、共通adapter、公開設定には接続しない。
テストでは実際のデフォルトゲートで3件とも`parcelTermsUnreviewed`を確認し、intakeはblocked、承認false、adapterPreview=nullのままで、既存基準データ・tile状態が変わらないことを検証する。
