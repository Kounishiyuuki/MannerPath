# 金沢南部12施設 — PR #343最終監査と正式掲載への移行判定

**PR #343は未承認調査/intakeとしてMERGE READY。28施設のうち今回正式掲載可能になった施設は0、adapter追加0、公開追加0。**
最新取得のorigin/main `3b5fd608dab2b3e97be18931836c3f7839ea7450` とPR head `f0c2e03793077b1fe74f7faeaeffaa461c452cdd` を2026-10-26に監査。
この追補は同じブランチ/PRで作成。mainへのmerge・Cloudflare本番操作・promotionコマンド・外部問い合わせ送信は行わない。
施設を増やす調査ではなく、既存6件を優先したブロッカー審査。旧facts/receipt/intake・取得証跡は書き換えない。

## 最終監査

- 関連Issueは[#67](https://github.com/Kounishiyuuki/MannerPath/issues/67)、[#113](https://github.com/Kounishiyuuki/MannerPath/issues/113)、[#137](https://github.com/Kounishiyuuki/MannerPath/issues/137)。候補受付をsource追加/公開実績へ加算しない、存在・権利・位置・現況・unknown・安定IDの各要件を維持。
- `PRODUCT_REQUIREMENTS` §10/SPECIFICATION、`OFFICIAL_SOURCE_INTAKE`、DATA_POLICY/SOURCES、ADR-0002/0006/0008/0011/0012/0017/0018を照合。特にADR-0018 D-R/D-A/D-Cは既に承認された技術経路で、件数のための新しい例外は設けない。
- 集計は28＝独自一次9＋制限付き記載3＋未確認12＋禁煙/廃止4、設備記載確認は12、intakeは6。残り6件の全てが独立一次で確認済みという意味ではない。サンマルコ・オメガ・KEIZは独立設備証拠が未取得。
- 元のHTTP ledger12件について、リポジトリ外の実取得ファイルのbyte長/SHA-256を全件再計算して一致。ABR ZIP15件も実ファイルとmanifestのdigestが一致。HTML/ZIPは追加コミットしない。28全件の現地確認や本番データ照会を行ったという意味ではない。
- 6つの正規化facts→receipt→生成intakeは全件BLOCKED、productionApproval=false、adapterPreview=null。時間/利用資格/たばこ対応/位置はunknownのまま。source:intakeは正式取込でも重複解決でもない。
- ABR releaseのappend登録以外に本番処理の変更なし。parcel/町字結果をfacility anchorへ昇格せず、許容residential_detail/block・旧Tokyo release・公開ゲートは不変。
- 登録済みfixture/sourceを名称・運営者/施設で照合し対象12施設の一致なし。先行金沢4候補とも別施設。未承認source登録拒否と、既存fixture corpusのID/タイル本文/hash/revision/parts/membership不変を既存回帰で確認。本番DBを読んだ、または本番全件重複を否定したという主張ではない。
- `make contract`、Node24での`make api-validate`（API1381/1381・discovery102/102）、`git diff --check`が成功。初回はホストNode23で`api-validate requires Node >=24 (found v23.3.0)`となり、既存の一時Node24を指定して再実行した。PR headのCI成功も確認。追補後の検証/CIはPR本文へ別に記録する。

## 12施設の8項目審査

施設ごとの一次情報、設備、利用条件、施設住所と実位置、areaApproximate、権利、ブロッカー、具体的解消手段は
[publication-plan.json](../../services/data-pipeline/research/official-source-intake/kanazawa-south/publication-plan.json) に全12件を分離して記録した。
これは公開用fixtureではなく審査計画。優先6件の事実は旧factsを保持し、今回の追加確認を別記録とした。

| 順序 | 施設 | 今回確認できた前進 | 決定的に不足する資料 |
| --- | --- | --- | --- |
| 1 | しあわせの湯 | [FAQ](https://shiawasenoyu.co.jp/info.html)の2階喫煙室を再確認。浴場の禁煙と区別 | 正当な施設代表点。2階が受付前/後か、入浴しない来訪者の資格。利用資格が未確認でもunknownを保ち、一般公開とはしない |
| 2 | 飛行船 工大前 | [運営者ポリシー](https://hikaricorp.jp/policy/)の所在・内容未確認を解消。[店舗](https://hikaricorp.jp/karaoke/koudaimae.html)固有のブースと更新案内を再確認 | 代表点と点の意味/権利。source別D-R審査記録。ブース単独利用の条件 |
| 3 | ホームランGOGO野々市 | [独自店舗ページ](https://homerun.co.jp/shop_nonoichi.html)のブースを再確認。P-WORLDから独立 | 代表点、設備の内外、遊技しない来訪者の利用資格。source別D-R審査 |
| 4 | 倉式御経塚 | [当該店舗](https://www.saint-marc-hd.com/kurashiki/shop/19/)の選択済みサービスにブースあり。共通凡例ではない | 代表点と権利審査。注文要否、ブース内外 |
| 5 | 満天の湯・道の宿 | [FAQ](https://www.manten-hotel.com/michinoyado-1/faq/)の**非宿泊客の客室階立入制限**を確認。[宿泊約款](https://www.manten-hotel.com/img/pdf_agreement.pdf)全4頁を読了 | 代表点。1階室の利用資格。客室階を一般公開としない。施設1anchorなら複数階を1地点へ集約 |
| 6 | 星乃金沢押野 | [店舗固有行](https://www.hoshinocoffee.com/shop.html)のブースありを再確認。[親会社方針](https://www.n-rs.co.jp/privacypolicy/)を確認 | 代表点。親会社の個人情報方針をブランドサイト利用規約と誤認せず適用範囲を審査 |
| 7 | 福々亭 | 店外喫煙場所という旧観測とHTTP403の限界を維持 | 許容経路で得た現行運営者資料/規約。店外場所が施設敷地内か、代表点の範囲が適合するか。403回避はしない |
| 8 | 快活CLUB金沢久安 | [現行店](https://www.kaikatsu.jp/shop/detail/20413.html)と[全店FAQ](https://www.kaikatsu.jp/faq/)の二資料による根拠と明確化。店ページ自身の設備記載とはしない | [会員規約13条](https://www.kaikatsu.jp/guide/use_002.html)の公開Web事実への適用範囲/許諾。代表点。設備のみの利用可否 |
| 9 | ゆず庵金沢有松 | [店舗固有の喫煙室](https://www.shabu-yuzuan.jp/shop/4131/)とfooterから[適用規約](https://www.monogatari.co.jp/about/)への経路を再確認 | 営利利用・リンク・問い合わせ回答の二次利用に関する権利者の条件。代表点。回答自体を勝手に公開用証拠にしない |
| 10 | オメガ野々市ホワイトバード | [独立運営者の事業所一覧](https://www.daiichibussan.co.jp/contents/office.html)と[沿革](https://www.daiichibussan.co.jp/contents/history.html)で運営者/施設住所の出典依存を解消 | 独立した現行設備情報。住所は設備座標ではない。代表点/再利用条件 |
| 11 | サンマルコ | 独立設備証拠を未発見。制限付きリードから設備値を移さない | 店舗が直接独立して提供する設備・位置・利用条件/再利用条件 |
| 12 | KEIZラパーク金沢 | [運営者店舗](https://www.heiseikankou.com/shop/store_19.html)/[FAQ](https://www.heiseikankou.com/faq/)は施設存在の根拠に留めた | 運営者による設備の明示、位置、再利用条件。P-WORLDへの誘導を独立証拠と扱わない |

しあわせの湯・飛行船・ホームラン・倉式は、設備存在の一次根拠が明確で、次の決定的な入力は施設代表点。
この順序は審査効率の判断で、掲載保証ではない。所在地だけでareaApproximateを発行しない。
富樫・円光寺・山科・泉野の未確認/廃止施設を件数に足さず、既存6件の不足資料取得を先にする。

## 満天の公的anchor探索を実データで打ち切った理由

[市の災害時避難場所](https://www.city.nonoichi.lg.jp/soshiki/2/960.html)（2026-10-01更新）の予備避難所19は同施設・柳町460。
しかし、住所の掲載は数値施設点でも喫煙利用の許可でもない。[オープンデータページ](https://www.city.nonoichi.lg.jp/soshiki/10/155.html)がCC BY4.0を明記する次の実CSVには対象がない。

| 公的resource | HTTP / 内容確認 | SHA-256 |
| --- | --- | --- |
| [指定緊急避難場所](https://www.city.nonoichi.lg.jp/img/opendata/172120-evacuation-space.csv) | 200 / 指定10施設、満天なし | `cc1cec0efde865f4e096a83bf5b6e32f862f3dd441c6f5dae5e7d0b3fdad4184` |
| [公共施設](https://www.city.nonoichi.lg.jp/uploaded/attachment/40274.csv) | 200 / 193行、満天・倉式・星乃の名称/住所一致なし | `583852965288aeaac5604099099cf0d444b7ea7e16298e6aaa063df5712ac988` |

市CKANの`野々市 避難`も同じ指定避難場所datasetのみ。近隣学校の点へ寄せず、Google/Apple/OSM/地図画素を使わない。
次は市防災担当または施設へ「予備避難所19の数値代表点が別の公開資料にあるか」を具体的に問う文案を用意する。
未発見はデータ不存在の断定ではない。数値点を受領しても出典/座標系/点の意味/再利用条件を独立審査する。

追加資料の取得証跡：飛行船policy HTTP200、16,627 bytes、SHA-256 `35980697185a42d59d94710714e3f0ad5a7626b0e4afaca928c7ed32f60df35b`（2026-10-26T05:19:25Z）。
満天の宿泊約款PDF HTTP200、8,430,348 bytes、SHA-256 `2a1d442eb2156749b555755fe4316ea522b55e4b699bcaeb82efbe3f9c6a39d6`。日本語2024.01/英語2014.09の全4頁を視認。原本はrepo外。

## 優先順位3の限定探索（既存28件とは別枠・intake追加なし）

既存6件/残り6件の判定後に、南部の金沢国際ホテルと、周辺公共施設の金沢歌劇座だけを限定確認した。

- 金沢国際ホテル：[公式FAQ](https://www.kanazawakokusaihotel.co.jp/question/)は館内喫煙コーナー、[婚礼ゲスト案内](https://www.kanazawakokusaihotel.co.jp/wedding/guest/)は披露宴会場フロアの設備を明示。しかし[アクセス](https://www.kanazawakokusaihotel.co.jp/access/)はGoogle埋込で、確認した運営者HTMLに独立した数値施設点なし。[市AED313行](https://catalog-data.city.kanazawa.ishikawa.jp/dataset/172014-aed)・[都市圏AED736行](https://catalog-data.city.kanazawa.ishikawa.jp/dataset/ishikawa-central-aed)・[市観光20行](https://catalog-data.city.kanazawa.ishikawa.jp/dataset/172014-tourism)にも対象名/住所の一致を得られず。権利・非宿泊客/非婚礼客の利用資格も未承認で、掲載readyは0。施設存在/設備記載だけでintakeやfixtureを増やさない。
- 金沢歌劇座：[現行利用案内](https://www.kagekiza.gr.jp/info/)と[運営財団FAQ](https://www.kanazawa-arts.or.jp/faq/)から現行の喫煙場所を裏付けできず。古い第三者イベント図や一般的な「所定場所以外禁止」という規則を存在証拠にしない。設備不存在という判定でもない。追加取込なし。

いずれも正式掲載条件を揃えられていない。既存28件の集計へ足さず、6件の代表点取得を先に解決する。

## 権利と位置を独立に解消する受入条件

1. **権利担当**：一次の正規化事実について適用規約・条項・reviewer/date・出典表記を記録する。ADR-0018 D-Rは承認済みなので、禁止のない一次情報に新たな個別問い合わせ許諾を必須化しない。明示禁止/適用不明の場合は必要範囲を特定して許諾資料を得る。個人情報方針の読了だけで権利承認しない。G5等の製品出荷審査とも別。
2. **位置担当**：存在情報とは独立した数値点のpublisher/resource/digest/座標系/意味/再利用条件と同一施設性を確認。喫煙室自身の点か施設代表点かを区別し、後者はareaApproximate/facilityのみ。ABRの基準は変更しない。
3. **実装担当**：両者と現況が整ってからimmutable normalized fixture/PROVENANCE、source-specific adapter、SOURCES/registryへ進む。未知の利用条件・喫煙時間・対応たばこはunknown。施設時刻/料金/業種から補完しない。同一anchorは1地点に集約。既存corpusとの重複・安定ID・近接異地点をレビューする。
4. **検証担当**：source固有fixture選択/非選択、unknown、存在と位置の分離、権利禁止、anchor authority、quality/cross-source/Releaseデータ不変の回帰を追加。`make api-validate`/`make contract`とCIを通す。今回の権限ではpromotionコマンド、本番反映、外部送信は行わない。

[未送信文案](../../services/data-pipeline/research/official-source-intake/kanazawa-south/INQUIRY_DRAFT.md)を施設別に追加した。
座標は「Google等の地図リンク」ではなく独立した出典を求める。無回答を許諾や設備不存在に変換しない。
PR #343未統合のため、次の正式adapter実装用ブランチはまだ作らない。統合後に別作業として始める場合のみ、ユーザー指定の`feat/kanazawa-publishable-smoking-spots`を最新origin/mainから作る。既存worktreeをreset/switchしない。
