# OSM smoking-specific data: bounded viability research (2026-10-04)

**OSM ROUTE: NOT WORTH V1.** 明示tagでhost inferenceなしに抽出できる候補は **1,046 OSM features**。OpenPOI/Overtureの名前候補より強い存在シグナルだが、独立・現存・一般利用可能な1,046か所とは言えない。既存official DBへの統合はADR-0010で拒否済み。独立OSM-only DB/exportは技術的には可能でも、同じ喫煙場所を複数sourceで補完・重複除去する提供方法の法務確認と第二の公開系統が必要であり、v1には見合わない。**release後に回す。LEGAL REVIEW REQUIRED。** この判断で調査を終了し、以降の設計研究・実装は行わない。

## Scope and reproducibility

#167/#168/#169 merge済みの `origin/main` **aab8305** から `research/osm-smoking-viability` を作成。research only。source approval、ADR、production schema、pipeline、API、tiles、Apple appの変更なし。集計JSONは本書と同名の `.json`。raw応答、OSM element ids/names/coordinatesは `/tmp/osm-smoking-research/` のみに置き、gitに含めない。OSM編集者のuser/uidは集計・公開しない。

全国のOSM日本国area（`ISO3166-1=JP`, `admin_level=2`）でnode/way/relationを一度に取得した。bboxによる外国混入や検索APIの件数上限は使用していない。全国応答は **2,743 objects / 1,878,613 bytes**、runtime `remark` なし。OSM base **2026-10-03T18:55:02Z**、area base **2026-10-03T02:09:07Z**。取得日と編集日は現地確認日ではない。

```overpass
[out:json][timeout:90];
area["ISO3166-1"="JP"]["admin_level"="2"]->.jp;
(
  nwr["amenity"="smoking_area"](area.jp);
  nwr["smoking"~"^(dedicated|isolated|separated)$"](area.jp);
);
out meta center;
```

Endpoint: https://overpass-api.de/api/interpreter 。応答SHA-256はJSONに記録。unionはtype/id単位で重複しない。way/relationのcenterは研究表示用bbox centerであり、正確な喫煙位置・入口座標に転用しない。area境界・area更新遅延の影響は残る。このtag集合での全国集計であり、全tag流儀や未mappingの物理場所の完全数ではない。semicolon形式（例 `separated;isolated`）や `smoking:outside=*`、名前だけの検索はscope外。

独立cross-check: [Geofabrik Japan Taginfo](https://taginfo.geofabrik.de/asia:japan/api/4/tag/stats?key=amenity&value=smoking_area) は **1,028**（911 nodes / 115 ways / 2 relations）、data until **2026-10-02T20:05:20Z**。異なるsnapshot・extract境界なので全国Overpassの1,030と同一releaseとは扱わない。ADR-0010の旧1,027件を最新値として流用しない。

## Tags and host-free counts

[OSM smoking-area tag definition](https://wiki.openstreetmap.org/wiki/Tag:amenity=smoking_area) は指定喫煙areaを表す。[smoking key definition](https://wiki.openstreetmap.org/wiki/Key:smoking) では `isolated/separated` は施設内の喫煙方針、`dedicated` も喫煙者向け施設を含む。一方、`area=yes + smoking=dedicated` は喫煙zoneの例として示される。tag説明はデータ意味の資料であり、license判断には使用しない。

| 抽出/判定 | 件数 | 扱い |
| --- | ---: | --- |
| `amenity=smoking_area` | **1,030** | 明示的smoking-place feature（913 nodes / 115 ways / 2 relations） |
| core以外 `smoking=dedicated` | 58 | 内訳を確認、単独tagだけで採用しない |
| うち `area=yes + smoking=dedicated` のway/relation、host分類なし | **16** | 追加明示zone（15 ways / 1 relation）、coreと非重複 |
| その他dedicated | 42 | hostまたは意味が曖昧なため保留/除外 |
| core以外 `smoking=isolated` | 522 | 独立喫煙場所の証拠なし、hostからspot化しない |
| core以外 `smoking=separated` | 1,133 | 同上 |
| union | 2,743 | core + dedicated + isolated + separated |
| strict host-free candidates | **1,046** | core 1,030 + additional zone 16 |
| 保留/除外 | 1,697 | 42 + 522 + 1,133 |
| 現時点で本番公開可能 | **0** | ADR-0010/source rights gate維持 |

追加16件の条件は、way/relation、`area=yes`、`smoking=dedicated`、`amenity/shop/tourism/office/leisure/gambling` なし、`building` が未指定/`yes`/`roof` のいずれか。今回は16件のtagsを全件読み、明示zone以外のhost分類がないことを確認した。nodeの `area=yes` はzone形状を証明しないため保留。名前だけ・建物だけのdedicated、灰皿/bin、`was:amenity=smoking_area` も追加数に含めない。この保守的集合はhost-free候補の下限であり、dedicatedの残り42件がすべて偽陽性という意味ではない。

coreの `smoking` 内訳: missing **944** / `yes` **75** / `dedicated` **10** / `outside` **1**。これらはすでに `amenity=smoking_area` があるため数える。建物/飲食店に `smoking=yes` があるだけのfeatureは取得・独立spot化していない。`room=smoking` は追加16件中の1 relationに存在し、二重加算しない。

## Prefecture coverage

**coreとstrict host-free 1,046件の両方で46/47都道府県をカバー**。山形県のみ0件（現実の喫煙場所が存在しないという意味ではない）。47県areaすべてを列挙してcore集合との交差をcount、runtime remarkなし。県別合計 **1,030** は全国core数と一致。別snapshotは2026-10-03T18:58:00Z、area baseは全国取得と同じ。追加16件の県別内訳は未集計だが、唯一coreが0の山形県で `area=yes + smoking=dedicated` のway/relationを別途countし **0**、remarkなし（base 2026-10-03T19:03:06Z）。この広い条件でも0なので追加16件による47県目の拡張はなく、全候補も46県と確定。query/snapshot/digestはJSONに記録。

東京都271、神奈川県103、大阪府86で **460件 / 44.7%**。県の存在カバーと県内の実用的coverageは別で、青森2、福井1、長崎1など疎な県がある。

| 都道府県 | core features |
| --- | ---: |
| 北海道 | 36 |
| 青森県 | 2 |
| 岩手県 | 3 |
| 宮城県 | 16 |
| 秋田県 | 6 |
| 山形県 | 0 |
| 福島県 | 6 |
| 茨城県 | 23 |
| 栃木県 | 14 |
| 群馬県 | 7 |
| 埼玉県 | 50 |
| 千葉県 | 53 |
| 東京都 | 271 |
| 神奈川県 | 103 |
| 新潟県 | 4 |
| 富山県 | 3 |
| 石川県 | 3 |
| 福井県 | 1 |
| 山梨県 | 24 |
| 長野県 | 7 |
| 岐阜県 | 16 |
| 静岡県 | 29 |
| 愛知県 | 11 |
| 三重県 | 7 |
| 滋賀県 | 12 |
| 京都府 | 54 |
| 大阪府 | 86 |
| 兵庫県 | 19 |
| 奈良県 | 7 |
| 和歌山県 | 2 |
| 鳥取県 | 4 |
| 島根県 | 3 |
| 岡山県 | 10 |
| 広島県 | 17 |
| 山口県 | 2 |
| 徳島県 | 3 |
| 香川県 | 5 |
| 愛媛県 | 8 |
| 高知県 | 4 |
| 福岡県 | 27 |
| 佐賀県 | 3 |
| 長崎県 | 1 |
| 熊本県 | 9 |
| 大分県 | 11 |
| 宮崎県 | 14 |
| 鹿児島県 | 18 |
| 沖縄県 | 16 |

再現用prefecture queryはJSONに収録。初回kumi endpointの47県直接検索はHTTP 504、area一覧のみのGETはHTTP 406。次に全国coreを一度取得して47県areaと交差するPOSTへ限定し、成功。山形の追加zone確認も初回HTTP 406、User-Agent付き再試行で成功。成功応答のみで上表を作成。以降bulk取得・詳細設計は行わない。

## False positives and quality limits

- coreでは `access` 未指定 **1,016**、yes 9、customers 3、private 1、permissive 1。明示場所の数と一般利用可能数は別。private/customer/施設内roomの条件を無視して公開できない。未指定はpublicと推定しない。
- coreでnameあり107、opening_hoursあり45、check_dateあり122。**985件はopening_hours未指定**。unknownはunknownのまま。tobacco type supportも推定しない。
- coreの最終編集年は2015–2026に分散、2026は143件のみ。編集時刻は現存確認・surveyではなく、古さから廃止も推定しない。`check_date` も喫煙許可の確認対象・内容まで保証しない。
- 喫煙tagの誤入力、廃止後のtag残存、同一場所のnode/area重複、施設内階違い、境界上featureを残存リスクとする。coreに `smoking=no` または `disused=yes` は見つからなかったが、現地偽陽性率 **UNKNOWN**、ゼロではない。
- 明示場所以外のdedicatedには飲食店・ホテル・retail/apartments、裸のnodeなどが実在。`isolated/separated` は大半が施設の分煙方針。hostの中心から喫煙室を作らない。
- **distinct current physical places、official DBに対する純増、現地precisionは未測定**。この研究ではofficialとのcross-source照合や重複除去を行わない。1,046を純増・精度確認済み・public spot数と呼ばない。

## ODbL obligations (primary materials only)

法的結論ではなく、以下は一次本文とOSMF指針に基づくengineering上の保守的評価。法務未確定点は **LEGAL REVIEW REQUIRED**。本研究はADR-0010を変更しない。

| 論点 | 一次資料から確認した条件 / MannerPathへの含意 |
| --- | --- |
| Attribution | OSM credit、license link、DB内/metadata/docsのnotice。map/list/detail/offline/watch等で表示元を明示。Apple basemap creditでOSM spotのcreditを代替しない。 |
| Produced Work | 画像などの表現成果物。公開時noticeが必要。基礎がDerivative DBならdatabase offerも残る。 |
| Derivative Database / share-alike | substantial抽出・変更DBをpublic useする場合、ODbL条件で公開。全国抽出をinsubstantial扱いしない。 |
| Database offer | §4.6: 全Derivative DB、または全変更（追加内容含む）/変更方法をmachine-readableでrecipientへoffer。internet配布は無料。元のOSMダウンロードURLだけではMannerPathの変更を提供できない。 |
| API / tile redistribution | recordを再構成できるJSON/vector tilesはDBとして扱う保守的方針。notice、ODbL、offerを保持。1 requestの小ささで全国累積抽出義務を回避しない。 |
| Mixed database | 同種POI補完・重複除去はCollective指針の安全域外。official DB全体/混合出力への義務波及は法務未確定。 |
| Collective database | 独立DBの集合にはshare-alikeの限定がある。ただし物理分離だけではindependenceを証明できない。 |
| Source separation | 完全OSM-only DB/exportは義務をそのlaneに限定する有力候補。相互参照・混合API・重複抑制・同種補完後の法的境界は **LEGAL REVIEW REQUIRED**。 |

Sources reviewed 2026-10-04:

1. [ODbL 1.0 original legal text](https://opendatacommons.org/licenses/odbl/1-0/): definitions §1; notices §§4.2–4.3; share-alike §§4.4–4.5; offer §4.6; restriction/parallel distribution §4.7. ソフトウェア自体へのlicense強制とは別（§2.3）。
2. [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines): DB/metadataとinteractive-map credit、readable/linkable notice。offlineや小画面でもlicense情報へ到達可能にする必要を評価。
3. [OSMF Produced Work Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline): extraction用出力と表現成果物の区別。公開画像だから基礎Derivative DBのoffer不要とは言えない。
4. [OSMF Collective Database Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline): independent DB、地域/データ種別の条件、restaurant補完・dedupの否定例。これは唯一の合法構成の定義ではない。
5. [OSMF Horizontal Map Layers Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Horizontal_Map_Layers_-_Guideline): 同種featureを補完する相互作用は別layerでも義務対象となる指針。単なるlayer分けを免責条件にしない。
6. [OSMF Substantial Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline): systematic/repeated extractionの扱い。全国1,046件は小規模単発利用の例外に依存しない。

§4.7のため、データ再利用を妨げるAPI利用規約/technical restrictionだけに依存できない。適切なunrestricted parallel copy等の扱いも法務確認対象。OSMF指針はlicense本文に優越せず、裁判所の最終判断を置換しない。日本での権利適用、official各licenseとの適合性、source間のidentity/reference、UIでの混合・重複抑制は未確定。

## Isolation feasibility and implementation scope estimate

**OSM-only source database / exportを単独提供するなら技術的には現実的。MannerPathのofficial laneから義務を限定できる可能性はあるが、採用可能との法的断定はしない。** storageだけ別でも、同じ喫煙場所の統合結果を一つのAPI/listへ出し、補完・dedupする構成の適法性は確認できていない。最も保守的な評価対象は独立OSM source lane、独立export/API/tiles、source別表示、officialへの値転記なし。これを今から設計しない。

見積もりは実装計画ではなくcost判断用。法務承認後でも、専用source review/ADR承認、bounded ingest・更新/削除/quality gate、独立DBとrelease lineage、OSM-only machine-readable offer、別API/tile/cache配布、client source/confidence表示とattribution、offline/watch確認、回帰検証が必要。**1 engineerで概ね2–4週間以上**の粗いengineering見積もり（未検証、法務待ち・再設計・運用保守は別）。単一adapter追加で完了する規模ではない。公開Overpassを各client requestから呼ぶ構成は不可。

## Stop decision

終了条件 **B** を満たす。約千件の明示featureにはpost-release候補としての価値がある。しかし、public/current/distinct/net-new未確認の上、第二公開系統と同種feature混合の法務costがv1前に必要となる。**v1へ入れる価値は現時点で低く、releaseを待たせない。release後に回すべき。** OSM採用の恒久否定でも、OSM全体に喫煙データがないとの結論でもない。今は **NOT WORTH V1** で閉じる。

Validation: `make contract` and `git diff --check` (results recorded in PR/final report). Research-onlyなのでapp/backend実装testは対象外。raw dump不在、JSON整合性、47県集計と件数整合性を確認する。
