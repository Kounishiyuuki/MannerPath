# High-value source rights request packages — 2026-10-09 JST

Follow-up to [2026-10-04 rights review](2026-10-04-high-value-source-rights.md) for
[#137](https://github.com/Kounishiyuuki/MannerPath/issues/137) (with #67, #113, #141).
Branch: `docs/high-value-source-rights-packets`. Scope: the three highest-priority
publishers only — **中央区, 川崎市, 広島市**.

**Status: request packages READY TO SEND by a maintainer. Nothing was sent.** No email,
form or phone contact was made. No permission exists yet; no source is onboarded,
registered or fixtured by this record. Data rows/coordinates are not copied into the
repository. This is an engineering reuse-request package, not legal advice.

## What changed since 2026-10-04 (fresh direct GETs, 2026-10-08T18:10Z UTC)

| Item | 2026-10-04 record | 2026-10-09 fresh observation |
| --- | --- | --- |
| 中央区 `map_data.csv` | 177,844 B, SHA256 `fa01ff6c…` | **177,840 B, SHA256 `921f3e98232c4ee0f40de360484cec47dce46b09f70be96656a809032d40fe53`** (resource changed; rows not diffed against the prior copy) |
| 中央区 smoking rows | 79 (76 `13007003000` + 3 `13007000000`) | unchanged: 79 = 76 + 3; 772 lines incl. header |
| 中央区 OD catalog | 35 rows, no smoking | 35 data rows, `喫煙` 0 matches; `map_data.csv` not listed; `公共施設一覧` CSV also 0 `喫煙` matches |
| 中央区 OD page scope | inferred from PDF | **explicit on OD page**: 「当ライセンスは、本サイトに掲載しているデータのみに適用されますので、それ以外のデータについては、中央区ホームページにおける著作権の取扱いに準じてください。」 |
| 中央区 inventory | dated 2026-10-02 | unchanged date; 7 indefinite suspensions, 1 dated inspection (R8-09-21, may extend), 1 relocation reopened R8-07-10, 1 paper-cigarette suspension |
| 川崎市 list | dated 2025-08-07 | **更新日 2026-10-06**; 12 designated places, address/relative description only |
| 広島市 list | dated 2025-02-16 | unchanged; 6 booths in central parks |
| 広島市 OD terms | "does not establish licensing for ordinary page" | confirmed: terms define 当サイト = 「広島市オープンデータポータルサイト」 only |

Not re-extracted this time: text of 中央区 terms PDF and 川崎市 OD rules PDF (no PDF
text tool in this environment; both returned HTTP 200). Their 2026-10-04 readings are
carried forward and marked as such.

## Conclusion on 中央区 CC BY scope (requested re-check)

`map_data.csv` and the smoking inventory HTML are **not** inside the existing CC BY 4.0
grant, on three independent official grounds:

1. The CC BY statement is scoped to 「本サイトに掲載しているデータのみ」 on the OD page,
   and everything else falls back to the ordinary site copyright handling.
2. The OD catalog CSV (35 rows) lists neither `map_data.csv` nor any smoking dataset;
   the listed `公共施設一覧` does not contain smoking places.
3. The ordinary site terms say: 「著作権法上認められている行為を除き、無断で転載や改変などを行うことはできません。」

Therefore attribution alone cannot be used. Explicit permission (or the ward adding the
resource to the OD catalog under CC BY 4.0) is required.

## Per-publisher packets

### 中央区

| # | Field | Value |
| --- | --- | --- |
| 1 | Official publisher | 中央区 (content owner of inventory: 中央区保健所生活衛生課生活衛生事業係; OD program: 企画部情報システム課デジタル推進係) |
| 2 | Exact resource | (a) `https://www.city.chuo.lg.jp/shisetsu/chizu/csv/map_data.csv` — only rows with category `13007003000` / `13007000000` (指定喫煙場所); (b) inventory HTML `…/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html` |
| 3 | Landing page | Map: `https://www.city.chuo.lg.jp/shisetsu/map/sonota/index.html` (ページID 13487, genre 指定喫煙場所); inventory page above |
| 4 | Current terms | Ordinary site terms (`…/aboutwebsite/thissite.html`): unauthorized republication/modification prohibited. OD CC BY 4.0 does **not** cover these resources (see above) |
| 5 | Known blocker | Rights (no grant for CSV/HTML). Plus current-operation: 7 indefinite suspensions, 1 relocation, 1 paper-only restriction |
| 6 | Coordinate situation | Publisher numeric lat/lng per row (79/79 within Japan range on 10-04). CRS and point semantics (booth vs. entrance vs. building) unconfirmed. Relocated site must not reuse old coordinate |
| 7 | Expected scale | 79 rows; ≤~71 plausibly active after suspensions (not per-row verified) |
| 8 | Requested scope | Q1–Q13 below, for both (a) and (b), smoking rows only |
| 9 | Attribution | Proposed: 「出典：中央区『指定喫煙場所』（地図データ map_data.csv／指定喫煙場所一覧）を加工して作成」+ retrieval date; ask the ward to confirm/replace wording |
| 10 | Next actions | See response table; special case: if ward says "add to OD catalog under CC BY 4.0", treat as APPROVED_WITH_ATTRIBUTION once listed |

Send target candidates (要確認 which is the decision owner):
- Primary: 中央区保健所生活衛生課生活衛生事業係 (owner of the smoking inventory; contact on that page, tel 03-3546-5762).
- Copy / OD route: 企画部情報システム課デジタル推進係 (OD page contact, tel 03-3297-0211) — ask whether the smoking layer can be added to the OD catalog.
- The map page itself has no per-page contact; the CSV system owner is not identified.

### 川崎市

| # | Field | Value |
| --- | --- | --- |
| 1 | Official publisher | 川崎市 市民文化局 市民生活部 地域安全推進課 |
| 2 | Exact resource | 「指定喫煙場所一覧」 table (名称・場所) in `https://www.city.kawasaki.jp/kurashi/category/262-2-4-0-0-0-0-0-0-0.html` (コンテンツ番号 40003) |
| 3 | Landing page | Same page 「川崎市路上喫煙防止対策」, 公開 2020-11-18 / 更新 2026-10-06 |
| 4 | Current terms | Site policy `…/main/site_policy/0000000027.html`: no unauthorized reproduction/diversion; republication by prior contact **on condition of no modification**. OD rules PDF scope CC BY 2.1 JP to listed datasets (10-04 reading, not re-extracted); smoking list not shown to be listed |
| 5 | Known blocker | Rights: the standard republication route forbids modification, which normalization/DB/tile output necessarily is. Location: address text only |
| 6 | Coordinate situation | No published coordinates. Addresses and relative descriptions (e.g. 「階段付近」「デッキ下」). Any point would be MannerPath-derived (ADR-0011 Proposed) or `areaApproximate` (ADR-0017) |
| 7 | Expected scale | 12 places across 6 station areas (Kanagawa: new coverage) |
| 8 | Requested scope | Q1–Q13 + Q14–Q16 (address reuse vs. derived coordinate, asked separately) |
| 9 | Attribution | Proposed: 「出典：川崎市『指定喫煙場所一覧』（市民文化局地域安全推進課）を加工して作成。位置座標は当方が住所等から推定したもので、川崎市が作成したものではありません。」 |
| 10 | Next actions | See response table. A reply granting only "unmodified republication" = MODIFICATION_PROHIBITED |

Send target candidate: 地域安全推進課 (page contact, tel 044-200-3839; address and mail
on the page). The site policy itself directs requests to each content's contact.

### 広島市

| # | Field | Value |
| --- | --- | --- |
| 1 | Official publisher | 広島市 環境局 業務部 業務第一課 美化係 |
| 2 | Exact resource | 「喫煙所（喫煙ブース）」 page `https://www.city.hiroshima.lg.jp/living/gomi-kankyo/1021281/1037470/1024206.html` — the 6 booth list (location name, address, photos) |
| 3 | Landing page | Same page, 更新 2025-02-16 |
| 4 | Current terms | Site terms `…/about/1010662.html`: no unauthorized use/copy/republication/sale/modification; consult the page's division in advance; division-specific terms take precedence. OD terms apply only to 「広島市オープンデータポータルサイト」; the booth list is not shown there |
| 5 | Known blocker | Rights (prior consultation required). Location: address/park only. Page warns of possible future closure |
| 6 | Coordinate situation | No published coordinates; park + 番地 text (e.g. 中区基町). Park polygons/centroids from separate datasets do not satisfy ADR-0017 v1 same-publication rule. Derived point → ADR-0011 |
| 7 | Expected scale | 6 booths (Hiroshima: new coverage) |
| 8 | Requested scope | Q1–Q13 + Q14–Q16 |
| 9 | Attribution | Proposed: 「出典：広島市『喫煙所（喫煙ブース）』（環境局業務第一課）を加工して作成。位置座標は当方が住所等から推定したもので、広島市が作成したものではありません。」 Photos excluded unless separately granted |
| 10 | Next actions | See response table. Also ask whether a booth coordinate list could be added to the OD portal |

Send target candidate: 環境局業務部業務第一課美化係 (page contact, tel 082-504-2098;
mail on the page). Site terms direct use requests to the page's division.

## Permission questions (send as a numbered list; ask for a yes/no/condition per item)

Common to all three (resource = the exact resource in the packet):

| Q | Item | Exact question |
| --- | --- | --- |
| Q1 | アプリ内表示 | 本資料の名称・所在地・利用条件等を、無料のiOSアプリ内の地図・一覧・詳細画面で表示してよいか |
| Q2 | DB保存 | 当方サーバのデータベースに取り込み、継続的に保存してよいか |
| Q3 | 加工 | 表記の正規化、項目分割、営業時間・休止情報の構造化、他自治体データと同一形式への変換をしてよいか（改変に当たるか） |
| Q4 | 緯度経度との結合 | 本資料の各地点に緯度経度（貴自治体提供のもの、または当方推定のもの）を付与・結合してよいか |
| Q5 | キャッシュ | アプリ端末内・CDNで一時/オフライン保存（最大数週間程度）してよいか |
| Q6 | API/タイル再配布 | 加工後のデータを当方の公開API・地図タイル形式で第三者（アプリ利用者等）に配信してよいか。外部開発者への一括提供は別途とするか |
| Q7 | 無料アプリ | 無料アプリ（広告の有無：<maintainerが記入>）での利用を許可いただけるか |
| Q8 | 将来の商用化 | 将来、有料機能や広告を導入した場合も同条件で利用継続できるか。不可なら再申請が必要か |
| Q9 | 出典表示 | 出典表示の要否と指定文言（上記案の可否）、表示場所（アプリ内クレジット画面・地点詳細） |
| Q10 | 元データ更新後の保持 | 掲載内容が更新・削除された場合、どの期間内に反映すればよいか。廃止地点の履歴を非公開で保持してよいか |
| Q11 | 第三者権利 | 掲載写真・図・地図画像等に第三者の権利が含まれるか。テキスト情報のみ利用する場合に支障はないか |
| Q12 | ライセンス形式 | 個別許諾ではなく、CC BY 4.0（または政府標準利用規約2.0）として扱ってよいか、またはオープンデータとして公開予定があるか |
| Q13 | 許諾の範囲・期間 | 許諾は今後の更新分にも及ぶか、期限・撤回条件はあるか、回答を公開記録に引用してよいか |

中央区 only:

| Q | Exact question |
| --- | --- |
| C1 | `map_data.csv` は「中央区オープンデータ」(CC BY 4.0) の対象外という理解で正しいか |
| C2 | `map_data.csv` の喫煙場所行の座標の測地系と、座標が示す位置（喫煙所そのもの／入口／建物代表点）|
| C3 | 一時休止中・移転後の地点はCSVへどう反映されるか（休止行の扱い、移転時の座標更新時期）|

川崎市 / 広島市 only — address reuse and derived coordinates asked **separately**:

| Q | Exact question |
| --- | --- |
| Q14 | 住所データの再利用：掲載住所・場所説明の文字列を、そのまま又は正規化して表示・保存・再配布してよいか |
| Q15 | 推定座標の作成：当方が住所・場所説明から地図上の推定位置（緯度経度）を作成し、「推定位置」と明示して表示・API/タイル配信してよいか。推定座標は貴自治体作成ではない旨を併記する |
| Q16 | 公式座標の有無：喫煙場所の緯度経度を貴自治体で保有・公開する予定はあるか（あればそちらを優先利用） |

Q14 granted but Q15 refused → address text may be shown, but no derived point; spot
can only appear as `areaApproximate` if ADR-0017 anchor rules are separately met.

## Inquiry letter template (Japanese; maintainer fills `<>`; DO NOT send from automation)

```text
件名：「<資料名>」の二次利用に関するお問い合わせ（喫煙可能場所案内アプリ）

<担当課> 御中

突然のご連絡失礼いたします。個人開発者の<氏名>と申します。
受動喫煙防止と路上喫煙抑止を目的に、指定喫煙場所・灰皿の所在を案内する
無料iOSアプリ「MannerPath」を開発しています。たばこの販売・宣伝は行いません。

貴<自治体>が公開している以下の資料を、アプリのデータとして利用したく、
利用可否と条件をご教示ください。

対象資料：
 - <資料名>：<URL>（<対象範囲：例 指定喫煙場所の行のみ>）

確認したい事項（項目ごとに 可／不可／条件付き でご回答いただけますと幸いです）：
 <Q1〜Q13 と自治体別質問をそのまま列挙>

出典表示案：<packet 9 の文言>

貴サイトの著作権に関する規定（<規定URL>）を確認のうえ、事前のご相談として
お送りしています。ご回答の窓口が別部署の場合はご教示いただけますと幸いです。

<氏名> / <連絡先メール>
```

Maintainer checklist before sending: personal contact details filled by hand; one mail
per publisher; keep the sent copy and reply in a private record, then summarize the
classification (not personal data) in a follow-up research note.

## Response classification

| Class | Meaning | Source onboarding | #141 (derived coordinates) | Publication | API / tile redistribution |
| --- | --- | --- | --- | --- | --- |
| APPROVED | Q1–Q8, Q10 granted, no attribution demand | Allowed after normal source review, fixtures, tests | Kawasaki/Hiroshima: only if Q15 granted **and** ADR-0011 accepted; else `areaApproximate` or hold | Allowed via existing gates (current-operation per row) | Allowed |
| APPROVED_WITH_ATTRIBUTION | As above + required credit wording | Allowed; registry records exact credit | Same as APPROVED; credit must state derived coordinate is ours | Allowed with credit in app + detail | Allowed; credit must travel in API/tile metadata |
| APPROVED_NO_REDISTRIBUTION | Display/DB OK, Q6 refused | Allowed only as client-display-only source; needs new design (not supported today) | No change | Blocked under current architecture (tiles = redistribution) | Blocked |
| NONCOMMERCIAL_ONLY | Q8 refused | Allowed only with a registry flag excluding it from any future paid/ads mode | No change | Allowed while app stays free/no-ads; must be removable | Allowed only to noncommercial clients; external bulk API blocked |
| MODIFICATION_PROHIBITED | Q3/Q4 refused (e.g. 川崎 「改変しないこと」) | Blocked (normalization and coordinate join are modification) | Blocked for this source | Blocked | Blocked |
| DENIED | Refused | Blocked; record and do not re-ask the same resource | Blocked | Blocked | Blocked |
| AMBIGUOUS | Partial/unclear answer | Blocked; send one clarifying follow-up listing the unanswered Q numbers | Blocked | Blocked | Blocked |
| NO_RESPONSE | No reply in 30 days | Blocked; one reminder after 30 days, then record as stalled after 60 | Blocked | Blocked | Blocked |

Rules for classifying: classify per resource (中央区 CSV and HTML separately). Take the
most restrictive applicable class. Q14/Q15 split for 川崎/広島 is recorded alongside the
class (e.g. `APPROVED_WITH_ATTRIBUTION, Q15=denied`). Phone-only answers are AMBIGUOUS
until confirmed in writing.

## Implementation required after a positive answer (not done here)

1. Research note recording class, conditions and credit text (no personal data).
2. `DATA_POLICY.md` source-registry entry with exact resource, license basis, attribution.
3. Importer + fixture using a minimal synthetic or permitted sample, tests, provenance.
4. 中央区: per-row reconciliation of suspended/relocated sites; CRS/point-semantic check.
5. 川崎/広島: ADR-0011 decision (#141) before any derived point; otherwise
   `areaApproximate` path only if ADR-0017 v1 anchor rules are met.
6. Attribution surfaced in app credits, spot detail, and API/tile metadata.

## Method and validation

Normal single GETs, one-second spacing, to official hosts only; files kept in session
scratch space, not committed. Counts above were computed from those copies. No
retry/bypass, no third-party coordinates, no geocoding. Validation for this docs-only
change: `make contract`, `git diff --check`.
