# High-value source rights request packages — 2026-10-09 JST

Follow-up to [2026-10-04 rights review](2026-10-04-high-value-source-rights.md) for
[#137](https://github.com/Kounishiyuuki/MannerPath/issues/137) (with #67, #113, #141).
Branch: `docs/high-value-source-rights-packets`. Scope: the three highest-priority
publishers only — **中央区, 川崎市, 広島市**.

**Status: request packages FINAL, ready for a maintainer's send decision. Nothing was
sent.** No email, form or phone contact was made. No permission exists yet; no source is
onboarded, registered or fixtured by this record. Data rows/coordinates, raw CSV and PDFs
are not copied into the repository. This is an engineering reuse-request package, not
legal advice; the letters below state our current understanding and ask the publisher to
confirm it.

## Fresh observations (direct GETs, 2026-10-08T18:10Z and 2026-10-09T05:00Z UTC)

| Item | 2026-10-04 record | Current observation |
| --- | --- | --- |
| 中央区 `map_data.csv` | 177,844 B, SHA256 `fa01ff6c…` | HTTP 200, final URL unchanged (`https://www.city.chuo.lg.jp/shisetsu/chizu/csv/map_data.csv`, `text/csv`), **177,840 B, SHA256 `921f3e98232c4ee0f40de360484cec47dce46b09f70be96656a809032d40fe53`** — same hash on 10-08 and 10-09 |
| 中央区 smoking rows | 79 (76 `13007003000` + 3 `13007000000`) | unchanged: 79 = 76 + 3 (see CSV drift section) |
| 中央区 OD catalog | 35 rows, no smoking | 35 data rows, `喫煙` 0 matches; `map_data.csv` not listed |
| 中央区 OD page scope | inferred from PDF | explicit on OD page (掲載日 2026-09-30): 「当ライセンスは、本サイトに掲載しているデータのみに適用されますので、それ以外のデータについては、中央区ホームページにおける著作権の取扱いに準じてください。」 |
| 中央区 inventory | dated 2026-10-02 | unchanged (掲載日 2026-10-02, ページID 3263) |
| 川崎市 list | dated 2025-08-07 | 更新日 2026-10-06; 12 designated places, address/relative description only |
| 広島市 list | dated 2025-02-16 | unchanged (更新日 2025-02-16); 6 booths in central parks |
| 広島市 OD terms | "does not establish licensing for ordinary page" | confirmed: terms define 当サイト = 「広島市オープンデータポータルサイト」 only |

## Terms PDF verification (fetched and parsed locally, 2026-10-09T05:00Z)

Both PDFs were downloaded from the official URLs to session scratch space and their text
layer extracted locally with macOS PDFKit (no OCR; both PDFs have a text layer). Not
committed.

| PDF | HTTP / bytes / SHA256 | Pages |
| --- | --- | --- |
| [中央区オープンデータ利用規約](https://www.city.chuo.lg.jp/documents/984/02termsofuse.pdf) | 200 / 164,630 B / `21e488605406cb74f656c36bce074b0631d957c4deaa3a7f310301e9b8c2045f` | 3 |
| [川崎市オープンデータ利用規約](https://www.city.kawasaki.jp/170/cmsfiles/contents/0000057/57493/kawasakiod_rules.pdf) | 200 / 60,022 B / `fc78e45d97235d6468043fc255658a91a4ff5033b8ddc3206b50a151c6837760` | 2 |

| Point | 中央区 PDF (平成29年9月20日制定) | 川崎市 PDF |
| --- | --- | --- |
| 適用対象 | 「中央区オープンデータページ」に掲載されているデータ。PDF cites the old URL `…/kusei/statisticaldata/opendata.html`; the current OD page is `…/kusei/gaiyou/toukeidate/opendata.html` | 「川崎市オープンデータ一覧（本サイト）に掲載されているデータ」 |
| License | CC BY 4.0 国際, 「特に記載のあるものを除いて」 | CC BY 2.1 (URL `creativecommons.org/licenses/by/2.1/jp/`), 「注があるものを除いて」 |
| 改変 | Allowed; separate credit template for modified use (「この[作品・アプリ・データベース等]は以下の著作物を改変して利用しています。…」) | Same structure: modified-use credit template |
| 再配布 | Not separately restricted beyond CC BY ("原則として二次利用が可能") | Not separately restricted beyond CC BY |
| 商用利用 | Not mentioned in PDF; CC BY does not restrict it. Prohibited: 公序良俗に反する利用 / 国家・国民の安全に脅威を与える利用 | Not mentioned in PDF; no use-type prohibitions listed |
| Attribution | `[タイトル]、中央区、CC BY 4.0 国際 (URL)`; hyperlink form allowed | `[タイトル]、川崎市、CC BY 2.1 (URL)`; hyperlink form allowed |
| 第三者権利 | User must respect third-party IP; user bears claims and must 弁償 the ward's costs | User must respect third-party IP; user bears claims |
| Other-site precedence | §3: precedence over other sites' terms **only when using 本サイト** | none |
| Per-resource scope | Only content on the OD page; exceptions where 特に記載 | Only data in the OD list; exceptions where 注 |

Result: **consistent with the 2026-10-04 reading; no correction needed.** Neither PDF
extends to the smoking CSV/HTML (中央区) or the smoking list page (川崎市), because
neither resource is listed in the respective OD catalog/list. One new detail recorded:
the 中央区 PDF names an outdated OD-page URL, so letter Q-C1 asks the ward to confirm
scope rather than relying on the URL.

## 中央区 CSV drift (2026-10-09T05:00Z copy)

- Encoding UTF-8 with BOM; 772 lines; 771 data rows; every row 11 fields.
- Header unchanged in shape from the 2026-10-04 description:
  `page_id, category, area, lat, lng, title, url, tel, fax, address, (empty)`.
  Publisher coordinate columns are `lat` / `lng` (decimal degrees; CRS not stated).
- Smoking rows (category `13007003000` or `13007000000`): **79 = 76 + 3, maintained.**
- Within the 79: missing/non-numeric coordinate **0**; all 79 inside a coarse 中央区
  bounding box; duplicate `page_id` **0**; **1 duplicate pair** sharing both `title` and
  `lat/lng` (both `13007003000`, different `page_id` and `url`) — needs publisher
  clarification (C4); single `area` value; no blank `url`/`address`; trailing column empty.
- Inactive/relocation markers (休止|中止|閉鎖|廃止|移転|移設|停止|撤去|工事|紙巻) in any
  smoking-row field: **0**. The CSV therefore does **not** carry the suspensions/relocation
  shown on the inventory page; operating status must come from the inventory HTML.
- Category change: none detectable within the current file (both categories present with
  the same counts as 2026-10-04).
- **Row-level diff against the 177,844 B copy: 比較不能.** No prior raw copy exists in this
  environment (only its hash was retained, by design). The 4-byte shrink is not explained;
  no inference is made about which rows changed.
- No obvious schema drift (column count, header, category codes, counts all stable).

## Contact routes (verified on official pages, 2026-10-09)

Addresses are written as the publisher writes them. `(at)` is the publisher's own
spam-guard notation; replace with `@` when sending. No address was guessed.

| Publisher | Primary (resource owner) | Phone | Email | Web form | Secondary |
| --- | --- | --- | --- | --- | --- |
| 中央区 | 保健所生活衛生課生活衛生事業係 (所掌に「受動喫煙対策」) — [inventory page](https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html), [課の業務案内](https://www.city.chuo.lg.jp/a0006/seikatueiseika.html) | 03-3546-5762 | `seiei_07(at)city.chuo.lg.jp` (業務案内 page) | none found; ward [問い合わせ案内](https://www.city.chuo.lg.jp/kusei/kouhoukouchou/kouhou/aboutwebsite/toiawase.html) directs mail to the section addresses and requires 住所・氏名・電話番号 | OD owner: 企画部情報システム課デジタル推進係, 03-3297-0211, `joho_03(at)city.chuo.lg.jp` ([業務案内](https://www.city.chuo.lg.jp/a0006/kusei/gaiyou/soshiki/kikaku/johosystem.html)). Note: the OD PDF's `joho_02@` is for reporting violations and belongs to 開発支援係 — do not use it for this request |
| 川崎市 | 市民文化局市民生活部地域安全推進課 — [list page](https://www.city.kawasaki.jp/kurashi/category/262-2-4-0-0-0-0-0-0-0.html) | 044-200-3839 (FAX 044-200-3869) | `25tiiki@city.kawasaki.jp` (on the list page) | none on the page (only the general サンキューコールかわさき and a telephone-relay service link) | Site policy directs reuse requests to each content's contact; separate OD-owner contact not identified (未確認; not needed while the list is outside the OD list) |
| 広島市 | 環境局業務部業務第一課美化係 — [booth page](https://www.city.hiroshima.lg.jp/living/gomi-kankyo/1021281/1037470/1024206.html) | 082-504-2098 (FAX 082-504-2229) | `gyomu1@city.hiroshima.lg.jp` (page contact block) | none on the page | Site-terms owner: ホームページ担当 082-504-2116, `koho@city.hiroshima.lg.jp` ([site terms](https://www.city.hiroshima.lg.jp/about/1010662.html)); terms direct use requests to the page's division, so 美化係 is primary |

Mail is the recommended route for all three (written answer needed; phone-only answers
are AMBIGUOUS, see runbook). 中央区: send one mail to 生活衛生事業係 with デジタル推進係 in Cc.

## Per-publisher packets

### 中央区

| # | Field | Value |
| --- | --- | --- |
| 1 | Official publisher | 中央区 (inventory owner: 保健所生活衛生課生活衛生事業係; OD program: 企画部情報システム課デジタル推進係) |
| 2 | Exact resource | (a) `https://www.city.chuo.lg.jp/shisetsu/chizu/csv/map_data.csv` — only rows with category `13007003000` / `13007000000` (指定喫煙場所); (b) inventory HTML `…/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html` |
| 3 | Landing page | Map: `https://www.city.chuo.lg.jp/shisetsu/map/sonota/index.html` (ページID 13487, genre 指定喫煙場所); inventory page above |
| 4 | Current terms | Ordinary site terms (`…/aboutwebsite/thissite.html`): unauthorized republication/modification prohibited. OD CC BY 4.0 does not cover these resources (OD page scope sentence + catalog absence + PDF scope) |
| 5 | Known blocker | Rights. Plus current-operation: 7 indefinite suspensions, 1 relocation, 1 paper-only restriction (inventory only; not in CSV) |
| 6 | Coordinate situation | Publisher `lat`/`lng` per row, 79/79 numeric. CRS and point semantics unconfirmed. Relocated site must not reuse old coordinate |
| 7 | Expected scale | 79 rows incl. 1 duplicate pair; ≤~71 plausibly active (not per-row verified) |
| 9 | Attribution (proposed) | 「出典：中央区『指定喫煙場所』（地図データ map_data.csv／指定喫煙場所一覧）を加工して作成」+ 取得日 |

### 川崎市

| # | Field | Value |
| --- | --- | --- |
| 1 | Official publisher | 川崎市 市民文化局 市民生活部 地域安全推進課 |
| 2 | Exact resource | 「指定喫煙場所一覧」 table (名称・場所) in `https://www.city.kawasaki.jp/kurashi/category/262-2-4-0-0-0-0-0-0-0.html` (コンテンツ番号 40003) |
| 4 | Current terms | Site policy `…/main/site_policy/0000000027.html`: no unauthorized reproduction/diversion; reuse by prior contact 「内容を改変しないことが条件」. OD rules (verified above) cover only the OD list |
| 5 | Known blocker | Rights: the standard route forbids modification, which normalization/DB/tile output necessarily is. Location: address text only |
| 6 | Coordinate situation | No published coordinates; addresses and relative descriptions. Any point would be MannerPath-derived (ADR-0011 Proposed) or `areaApproximate` (ADR-0017) |
| 7 | Expected scale | 12 places across 6 station areas (Kanagawa: new coverage) |
| 9 | Attribution (proposed) | 「出典：川崎市『指定喫煙場所一覧』（市民文化局地域安全推進課）を加工して作成。位置座標は当方が住所等から推定したもので、川崎市が作成したものではありません。」 |

### 広島市

| # | Field | Value |
| --- | --- | --- |
| 1 | Official publisher | 広島市 環境局 業務部 業務第一課 美化係 |
| 2 | Exact resource | 「喫煙所（喫煙ブース）」 page `https://www.city.hiroshima.lg.jp/living/gomi-kankyo/1021281/1037470/1024206.html` — 6 booth names and addresses (photos excluded) |
| 4 | Current terms | Site terms `…/about/1010662.html`: no unauthorized use/copy/republication/sale/modification; consult the page's division in advance. OD terms apply only to the OD portal |
| 5 | Known blocker | Rights. Location: park + 番地 text only. Page warns of possible future closure |
| 6 | Coordinate situation | No published coordinates. Separate park datasets do not satisfy ADR-0017 v1 same-publication rule. Derived point → ADR-0011 |
| 7 | Expected scale | 6 booths (Hiroshima: new coverage) |
| 9 | Attribution (proposed) | 「出典：広島市『喫煙所（喫煙ブース）』（環境局業務第一課）を加工して作成。位置座標は当方が住所等から推定したもので、広島市が作成したものではありません。」 |

## Letters (copy-paste; maintainer fills `<>`; DO NOT send from automation)

Each letter = **A. 本文** (short, sent as the mail body) + **B. 確認事項** (pasted below
A in the same mail). Fill `<氏名>`, `<連絡先メール>`, `<住所>`, `<電話番号>` by hand
(中央区 requires 住所・氏名・電話番号). `<広告>` = 「なし」 or 「あり（<内容>）」.

### Common block B (all three; paste after the publisher-specific questions)

```text
【共通の確認事項】（各項目に 可／不可／条件付き でご回答いただけますと幸いです）
Q1 アプリ内表示：対象資料の名称・所在地等を、無料iOSアプリの地図・一覧・詳細画面に表示してよいか。
Q2 保存：当方サーバのデータベースに取り込み、継続的に保存してよいか。
Q3 加工：表記の正規化、項目分割、休止情報等の構造化、他自治体データと同一形式への変換を行ってよいか（改変に当たる場合、許可いただけるか）。
Q4 位置情報の付与：各地点に緯度経度を付与・結合してよいか。
Q5 一時保存：利用者端末内・配信網（CDN）で一時的・オフライン用に保存（数週間程度）してよいか。
Q6 再配信：加工後のデータを当方のAPI・地図タイル形式でアプリ利用者に配信してよいか。外部開発者への一括提供は行わない予定です。
Q7 無料アプリでの利用：無料アプリ（広告：<広告>）での利用を許可いただけるか。
Q8 将来の有料化等：将来、有料機能や広告を導入した場合も同じ条件で継続利用できるか。できない場合は改めて申請すべきか。
Q9 出典表示：出典表示の要否と文言（下記案の可否）、表示場所（アプリ内クレジット画面・地点詳細画面）。
Q10 更新への追従：掲載内容が更新・削除された場合、どの程度の期間内に反映すべきか。廃止地点の履歴を非公開で保持してよいか。
Q11 第三者の権利：掲載内容に第三者の権利が含まれるか。写真・図は利用せず、文字情報のみ利用する場合に支障はないか。
Q12 ライセンス形式：個別のご許可ではなく、CC BY 4.0 等のオープンデータとして扱える予定があるか。
Q13 許可の範囲・期間：今後の更新分にも及ぶか、期限や撤回条件はあるか。ご回答の要旨（担当者の個人情報を除く）を当方の開発記録に残してよいか。

【ご回答の形式のお願い】
・Q番号ごとに「可／不可／条件付き（条件）」の形でメールにてご回答いただけますと幸いです。
・ご判断の担当が別部署の場合は、その部署をご教示ください。
```

### 中央区 — A. 本文

```text
To: seiei_07@city.chuo.lg.jp   Cc: joho_03@city.chuo.lg.jp
件名：指定喫煙場所データ（地図CSV・指定喫煙場所一覧）の二次利用に関するお問い合わせ

中央区保健所 生活衛生課 生活衛生事業係 御中
（写し：企画部 情報システム課 デジタル推進係 御中）

突然のご連絡失礼いたします。個人開発者の<氏名>と申します。
受動喫煙防止と路上喫煙の抑止を目的に、指定喫煙場所・灰皿の所在を案内する無料iOSアプリ
「MannerPath」を開発しています。たばこの販売・宣伝・購入誘導は行いません。

貴区が公開している次の資料を、アプリの地点データとして利用させていただけないか、
利用可否と条件をお伺いしたくご連絡しました。

【対象資料】
(a) 施設案内地図のCSV（指定喫煙場所の行のみ。分類 13007003000 / 13007000000）
    https://www.city.chuo.lg.jp/shisetsu/chizu/csv/map_data.csv
(b) 指定喫煙場所一覧（休止・移転等の情報を含む）
    https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html

【利用目的】
アプリ利用者が近くの指定喫煙場所を地図で探し、ルールに沿って喫煙できるようにするため。
各地点には出典と取得日を表示し、休止中の場所は休止中と明示します。

【現在の理解】
中央区オープンデータページの記載から、CC BY 4.0 は同ページ掲載データにのみ適用され、
上記(a)(b)は対象外であり、区ホームページの著作権の取扱い（無断での転載・改変不可）に
準じるものと理解しています。この理解でよいか、あわせて確認させてください。

詳細な確認事項を下に記載しました。ご多忙のところ恐縮ですが、ご検討いただけますと幸いです。

<氏名>
<住所>
<電話番号>
<連絡先メール>
```

### 中央区 — B. 確認事項 (before the common block)

```text
【中央区固有の確認事項】
C1 対象範囲：上記(a)(b)はオープンデータ利用規約（CC BY 4.0）の対象外という理解でよいか。なお同規約PDFに記載の「中央区オープンデータページ」のURLは現在のページと異なるため、適用範囲を確認させてください。
C2 座標：(a)の喫煙場所の行の緯度経度の測地系と、座標が示す位置（喫煙場所そのもの／入口／建物等の代表点）。
C3 休止・移転の反映：一時休止中・移転後の場所は(a)にどう反映されるか（休止中の行の扱い、移転時の座標更新の時期）。現在(a)には休止情報が含まれていないため、(b)との組み合わせで判断してよいか。
C4 重複：(a)の喫煙場所の行に、名称と座標が同一でページID・URLが異なる行が1組あります。同一場所の重複掲載か、別の場所かご教示ください。
C5 オープンデータ化：喫煙場所の情報をオープンデータ一覧に追加いただける予定はあるか。

【出典表示案】
出典：中央区「指定喫煙場所」（地図データ map_data.csv／指定喫煙場所一覧）を加工して作成（取得日：YYYY-MM-DD）
```

### 川崎市 — A. 本文

```text
To: 25tiiki@city.kawasaki.jp
件名：「指定喫煙場所一覧」の二次利用に関するお問い合わせ（喫煙場所案内アプリ）

川崎市 市民文化局 市民生活部 地域安全推進課 御中

突然のご連絡失礼いたします。個人開発者の<氏名>と申します。
受動喫煙防止と路上喫煙の抑止を目的に、指定喫煙場所・灰皿の所在を案内する無料iOSアプリ
「MannerPath」を開発しています。たばこの販売・宣伝・購入誘導は行いません。

貴市の「川崎市路上喫煙防止対策」ページに掲載の「指定喫煙場所一覧」を、アプリの地点データ
として利用させていただけないか、利用可否と条件をお伺いしたくご連絡しました。

【対象資料】
「指定喫煙場所一覧」（名称・場所の表）
https://www.city.kawasaki.jp/kurashi/category/262-2-4-0-0-0-0-0-0-0.html （コンテンツ番号40003）

【利用目的】
アプリ利用者が近くの指定喫煙場所を地図で探し、ルールに沿って喫煙できるようにするため。

【現在の理解】
貴市ホームページの著作権の案内では、転載は事前連絡のうえ「内容を改変しないこと」が条件と
されています。アプリでは表記の正規化や地図上の位置の付与が必要となり、これが改変に当たる
可能性があるため、事前にご相談させてください。また、本資料は川崎市オープンデータ一覧の
対象ではないと理解していますが、誤りがあればご指摘ください。

詳細な確認事項を下に記載しました。ご検討いただけますと幸いです。

<氏名>
<連絡先メール>
```

### 川崎市 / 広島市 — B. 確認事項 (before the common block)

```text
【住所情報と推定位置について（別々にご回答ください）】
Q14 住所等の再利用：掲載の住所・場所の説明文を、そのまま又は表記を整えて、表示・保存・配信してよいか。
Q15 推定位置の作成：当方が住所・場所の説明から地図上の推定位置（緯度経度）を作成し、「推定位置」と明示して表示・配信してよいか。推定位置は貴市が作成したものではない旨を併記します。
Q16 公式の座標：喫煙場所の緯度経度を貴市で保有・公開する予定はあるか（ある場合はそちらを優先して利用します）。

【出典表示案】
<packet 9 の文言>（取得日：YYYY-MM-DD）
```

### 広島市 — A. 本文

```text
To: gyomu1@city.hiroshima.lg.jp
件名：「喫煙所（喫煙ブース）」掲載情報の二次利用に関するお問い合わせ（喫煙場所案内アプリ）

広島市 環境局 業務部 業務第一課 美化係 御中

突然のご連絡失礼いたします。個人開発者の<氏名>と申します。
受動喫煙防止とぽい捨て防止を目的に、指定喫煙場所・灰皿の所在を案内する無料iOSアプリ
「MannerPath」を開発しています。たばこの販売・宣伝・購入誘導は行いません。

貴市の「喫煙所（喫煙ブース）」ページに掲載の喫煙ブース6か所の名称・所在地を、アプリの
地点データとして利用させていただけないか、利用可否と条件をお伺いしたくご連絡しました。
写真は利用しません。

【対象資料】
「喫煙所（喫煙ブース）」https://www.city.hiroshima.lg.jp/living/gomi-kankyo/1021281/1037470/1024206.html

【利用目的】
アプリ利用者が市内中心部の喫煙ブースを地図で探し、ルールに沿って喫煙できるようにするため。

【現在の理解】
貴市ホームページの「リンク・著作権・免責事項」では、無断での利用・複製・転載・改変等は
できず、事前に担当課へ相談することとされていると理解しています。そのため事前のご相談として
お送りしています。また、本資料は広島市オープンデータポータルサイトの対象ではないと理解して
いますが、誤りがあればご指摘ください。

詳細な確認事項を下に記載しました。ご検討いただけますと幸いです。
（追加の確認）H1 喫煙ブースの位置情報をオープンデータポータルで公開いただける予定はあるか。

<氏名>
<連絡先メール>
```

Maintainer checklist before sending: personal details filled by hand; one mail per
publisher; send A + 固有B + 共通B in one mail; keep sent copy and reply in a private
record; summarize only the classification (no personal data) in a follow-up research note.

## Response-handling runbook

Classify **per resource** (中央区 (a) CSV and (b) HTML separately), take the most
restrictive applicable class, and for 川崎/広島 record Q14/Q15 alongside the class
(e.g. `APPROVED_WITH_ATTRIBUTION, Q15=denied`). Phone-only answers stay AMBIGUOUS until
confirmed in writing. Nothing below is done until a written answer exists.

| Class | Trigger | Registry (`DATA_POLICY.md`) | Fixture | Adapter | #141 (derived coords) | API / tile redistribution | App attribution | Publication |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| APPROVED | Q1–Q8, Q10 可; no credit demand | Add entry: exact resource, permission date/basis, scope | Minimal synthetic or permitted sample | Implement + tests + provenance | 川崎/広島: only if Q15 可 **and** ADR-0011 accepted; else `areaApproximate` (ADR-0017) or hold. 中央区: n/a (publisher points) after C2 | Allowed | Credit screen lists source anyway (provenance rule) | Allowed through existing gates; 中央区 per-row current-operation reconciliation first |
| APPROVED_WITH_ATTRIBUTION | As above + required wording | Entry records exact credit text | As APPROVED | As APPROVED; credit carried in provenance | As APPROVED; credit must state derived coordinate is ours | Allowed; credit in API/tile metadata | Required wording in credits + spot detail | Allowed once credit renders |
| APPROVED_NO_REDISTRIBUTION | Display/DB 可, Q6 不可 | Entry flagged display-only; do not activate | None until design exists | Blocked — current architecture serves tiles (= redistribution); needs new design/ADR | No change | Blocked | n/a | Blocked |
| NONCOMMERCIAL_ONLY | Q8 不可 | Entry with noncommercial flag | As APPROVED | As APPROVED, removable by flag | As APPROVED | App clients only; no external bulk API | As granted | Allowed while app is free/no-ads; must be withdrawn before any paid/ads launch |
| MODIFICATION_PROHIBITED | Q3/Q4 不可 (e.g. 川崎 「改変しないこと」) | Record as blocked | None | Blocked (normalization/coordinate join = modification) | Blocked for this source | Blocked | n/a | Blocked |
| DENIED | Refused | Record as denied; do not re-ask same resource | None | Blocked | Blocked | Blocked | n/a | Blocked |
| AMBIGUOUS | Partial/unclear, or phone only | No entry | None | Blocked | Blocked | Blocked | n/a | Blocked; one follow-up mail listing unanswered Q numbers |
| NO_RESPONSE | No reply | No entry | None | Blocked | Blocked | Blocked | n/a | Blocked; one reminder at 30 days, record as stalled at 60 |

Special case: if 中央区 adds the smoking layer to the OD catalog under CC BY 4.0, treat as
APPROVED_WITH_ATTRIBUTION using the PDF's modified-use credit template, effective once
the catalog listing is observed.

Implementation after a positive answer (separate tasks, not done here): research note
with class/conditions/credit → registry entry → importer + fixture + tests → 中央区
suspended/relocated/duplicate reconciliation and C2 CRS check → 川崎/広島 ADR-0011
decision (#141) → attribution in credits, spot detail and API/tile metadata.

## Method and validation

Normal single GETs to official hosts only, one-second spacing; files kept in session
scratch space, not committed. PDF text extracted locally with PDFKit; CSV counts computed
locally with a stdlib Python script; no row values or coordinates transcribed. No
retry/bypass, no third-party coordinates, no geocoding, no contact made. Validation for
this docs-only change: `make contract`, `git diff --check origin/main...HEAD`.
