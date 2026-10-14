# Kanazawa-area official smoking-place data requests — 2026-10-14 JST

Lane 1; #67 / #113 / #137. Baseline main `0bde6a1` (after #268). Follows
[urban coverage #268](2026-10-14-urban-smoking-area-coverage.md),
[Ishikawa re-evaluation](2026-10-11-ishikawa-location-precision-reevaluation.md) and
[external providers #266](2026-10-14-nationwide-external-data-providers.md).

**Status: request packages prepared, nothing sent.** No email, form, phone or other contact was made. No
permission exists; nothing here is a licence, an approval or an onboarding. No source registry, adapter, fixture,
tile, production or remote D1 change. モクログ is excluded: the developer has already contacted it, and this
package must not send a duplicate. This is an engineering reuse-request package, not legal advice.

## 1. Why Kanazawa is still empty (prior rejections)

| Candidate | Prior result | Blocker that only the publisher can resolve |
| --- | --- | --- |
| 金沢駅 東口・西口 outdoor smoking places | Not onboarded (2026-10-11, #268) | Only a neighbouring operator (金沢百番街) refers to them. The city road-management page tells visitors to use 「喫煙所」 but does not list them, and the city's own publication is classed as rights-blocked / current-operation-unknown |
| 金沢百番街 / あんと indoor | Blocked | Operator FAQ (「あんと西1階」) contradicts its service page (「館外の喫煙所をご利用ください」); fails closed |
| 金沢フォーラス | Blocked | 利用規約 第7条 prohibits using site information beyond private use → `prohibited` (ADR-0018 §3) |
| 金沢21世紀美術館 outdoor corner | Held | Existence and facility anchor exist; ashtray installation unknown (the #268 batch criterion); museum long closure from 2027-05-06 |
| 香林坊大和 8F | Held / existence lead only | #268 records an operator listing; its official page was **not re-located in this session** (要確認) |
| JR West 北陸新幹線 station smoking rooms | Not onboarded | The JR West page lists stations with smoking rooms only, not their location; terms prohibit any use without permission |

The binding constraint is not precision but **a first-party statement with reuse permission** for each place.
Bounded absence of evidence is not a claim that a place does not exist.

## 2. Contact targets and priority

Every URL below was read in this session (2026-10-14) unless marked 要確認. Contact data are the publisher's
public desks only; no personal names.

| P | Target | Why | Official page / evidence read | Public contact route | Terms read |
| --- | --- | --- | --- | --- | --- |
| **1** | 金沢市 道路管理課 (station plaza manager) | Manages 金沢駅前広場; its page says 「喫煙マナーを順守願います。喫煙所をご利用ください。」 — the manager of the 東口/西口 places | [金沢駅 page](https://www4.city.kanazawa.lg.jp/soshikikarasagasu/dorokanrika/gyomuannai/30/28323.html) | Tel 076-220-2321, Fax 076-220-2274, [inquiry form](https://www4.city.kanazawa.lg.jp/cgi-bin/inquiry.php/84?page_no=28323) | City [copyright/disclaimer page](https://www4.city.kanazawa.lg.jp/11790.html) (広報戦略課); prior class rights-blocked |
| 1b | 金沢市 市民協働推進課 (ぽい捨て等防止条例) | Issued the station-area 路上喫煙 leaflet (2014): 「道路などの管理者が設置・許可している灰皿などがある場所での喫煙は『路上喫煙』にはなりません」 | [leaflet PDF](https://www4.city.kanazawa.lg.jp/material/files/group/39/ekituikatirashi.pdf) (発行：金沢市 市民協働推進課) | Current desk **要確認**: the leaflet is from 2014. Ask 道路管理課 to forward instead of mailing both |
| **2** | JR西日本 | Lists 金沢・富山・福井 among 北陸新幹線 stations with 喫煙ルーム | [受動喫煙防止の取り組み](https://www.jr-odekake.net/railroad/service/smoking.html) | お客様センター 0570-00-2486 (9–19時), [mail form](https://form.westjr.co.jp/visitor). No dedicated permission/corporate desk; the info page notes that research enquiries may go unanswered | [ご利用にあたって](https://www.jr-odekake.net/use/about.html): any use without permission is prohibited → needs explicit permission |
| 2b | IRいしかわ鉄道 (金沢駅 IR side) | Shares 金沢駅; station page lists no smoking facility | [金沢駅 info](https://www.ishikawa-railway.jp/station/kanazawa/?ctg=info) (no 喫煙 mention) | [inquiry page](https://www.ishikawa-railway.jp/inquiry/index.html) → form; 本社 076-256-0560 (平日9:00–17:45) | [サイトポリシー](https://www.ishikawa-railway.jp/policy/index.html): no copying/diversion without permission except quotation |
| **3** | 金沢百番街 (station building) | Names 金沢駅西口 (あんと「金沢かつぞう」入口付近) and 東口 (石川県立音楽堂向かい) outdoor places; its FAQ contradicts this | [館内サービス](https://www.100bangai.co.jp/info/) | No general contact page found; only [催事出店の問い合わせ](https://www.100bangai.co.jp//contact) → **要確認** (operating company not named on the page) | No site policy page found; footer "All rights reserved" |
| 3b | 金沢フォーラス (OPA) | Currently `prohibited`; only a written permission can change that | [利用上の注意](https://www.forus.co.jp/all/info/attention) 第7条 | [contact](https://www.forus.co.jp/kanazawa/contact) | 第7条 prohibits use beyond private use without consent |
| 3c | 大和 香林坊店 | 8F restaurant-floor smoking area (operator listing per #268) | **要確認** (official page not re-located; third-party listings ignored) | **要確認** | **要確認** |
| **4** | 金沢21世紀美術館 | 「喫煙は美術館の外の広坂口付近の喫煙コーナーでお願いします」; asks only for ashtray/operation facts | [利用案内](https://www.kanazawa21.jp/data_list.php?d=1&g=35) | site `/contact/` (from the page navigation) | Footer reserves expression (#268: `factReference`) |
| 5 | あいの風とやま鉄道 | 富山駅 shared with JR West; station page lists no smoking facility | [富山駅](https://ainokaze.co.jp/station/toyama) | [contact](https://ainokaze.co.jp/tips/contact) | [サイトポリシー](https://ainokaze.co.jp/policy): no use/copying without permission |
| 5b | 福井市 環境政策課 | 「禁止区域における喫煙は、御園通り北側にある喫煙所を利用してください」 (page last updated 2014-01-31; #268 records the 2023 underpass relocation) | [ぽい捨て等防止](https://www.city.fukui.lg.jp/kurasi/kankyo/akichi/poisute-fungai-kakudai.html) | Tel 0776-20-5609, mail form on the page | Ask; the city station XLS is CC BY 3.0 (#268) |
| 5c | ハピラインふくい / 富山市 | Lower priority | Official URL **要確認** (not found in this session; not guessed) | — | — |

Order of sending (a maintainer decision): **P1 金沢市 → P2 JR西日本 → P3 百番街**, then P4–P5 after the first answers,
so that one answer can shape the next letters. P1 alone can unblock the two highest-value Kanazawa places.

## 3. What every request asks (information)

1. 現在利用可能な喫煙所・喫煙ルームの一覧 (名称・設置場所の説明)
2. 灰皿の設置の有無と場所
3. 屋内・屋外の区分
4. 利用時間 (施設の営業時間とは別に定まっているか)
5. 一般利用の可否 (乗車券・入館・購入が必要か)
6. 廃止・移設・休止の予定と過去の変更 (既知の廃止を含む)
7. 位置を特定できる地図・図面・座標 (公開可否を含む)
8. 情報の更新頻度と最新版の掲載場所

Rights questions reuse the **common block Q1–Q13** of
[2026-10-09 rights requests](2026-10-09-high-value-source-rights-requests.md#common-block-b-all-three-paste-after-the-publisher-specific-questions)
unchanged (app display, storage, normalisation, coordinates, device/CDN cache, API/tile redistribution, free app,
future paid features, credit wording, old data after changes, third-party rights, licence form/term, updates and
revocation). They are not duplicated here, so one wording governs every letter.

## 4. Letters (copy-paste; maintainer fills `<>`; DO NOT send from automation)

Each mail = A (body, publisher-specific) + B (§3 items 1–8 as below) + the common block Q1–Q13.

### Common B — information questions

```text
【喫煙場所の情報についてのご質問】（分かる範囲で結構です）
I1 現在利用可能な喫煙所・喫煙ルームの一覧（名称・設置場所の説明）
I2 灰皿の設置の有無と設置場所
I3 屋内・屋外の別
I4 利用時間（施設の営業時間と異なる場合）
I5 一般の方の利用可否（乗車券・入館・購入等の条件）
I6 廃止・移設・休止の予定、および最近の変更
I7 位置を特定できる地図・図面・座標の有無と、その公開・利用の可否
I8 情報の更新頻度と、最新情報の掲載場所
```

### Project summary (paste where a letter says `<概要>`)

```text
MannerPath は、喫煙が認められている場所・灰皿の位置を地図で探すための iOS アプリです（開発中、TestFlight で試験配布中）。
・目的は路上喫煙・ポイ捨ての抑制と、喫煙しない方との分煙です。たばこの販売・購入リンク・銘柄の宣伝は行いません。
・掲載は、管理者・自治体など一次情報で存在が確認できた場所に限ります。地図サービスや口コミの情報だけでは掲載しません。
・位置が施設単位でしか分からない場合は「おおよその位置」と明示し、正確な位置のようには表示しません。
・出典と最終確認日を地点ごとに表示し、廃止・移設の連絡があれば掲載を取り下げます。
・個人の位置情報の履歴は収集しません。
```

### P1 金沢市 道路管理課 — A. 本文

```text
件名：金沢駅前広場の喫煙所情報の提供と、アプリへの掲載可否についてのお伺い

金沢市 道路管理課 御中

突然のご連絡失礼いたします。<氏名>と申します。<概要>

貴課の「金沢駅」のページで「喫煙所をご利用ください」とご案内いただいている、金沢駅東口・西口の喫煙所について、
アプリ利用者が迷わずたどり着けるよう、正確な情報を掲載したいと考えております。
現在、近隣の商業施設のご案内には記載がある一方、管理者である市のご案内として場所を確認できる資料を見つけられず、
掲載を見合わせております。

つきましては、下記についてご教示いただけますと幸いです。担当が別の課（例：ぽい捨て等防止条例の所管課）の場合は、
ご転送またはご担当をお知らせいただけますと助かります。

<Common B と 共通の確認事項 Q1〜Q13 をここに貼付>

連絡先：<氏名> <連絡先メール> <電話番号>
```

### P2 JR西日本 — A. 本文 (mail form)

```text
件名：駅の喫煙ルーム情報のアプリ掲載についてのお伺い（金沢・富山・福井駅）

西日本旅客鉄道株式会社 御中

<氏名>と申します。<概要>

貴社「受動喫煙防止の取り組み」で喫煙ルーム設置駅として掲載されている北陸新幹線 金沢・富山・福井駅について、
駅構内のどこにあり、どなたが利用できるかを利用者に正確にご案内したいと考えております。
貴社サイトの「ご利用にあたって」では、許可なくコンテンツを利用することが禁止されているため、掲載前にお伺いいたします。
本件のご担当部署が別にございましたら、ご教示いただけますと幸いです。

<Common B と 共通の確認事項 Q1〜Q13 をここに貼付>
特に I5（改札内のみか）と I6（廃止・移設）をお教えいただけますと助かります。

連絡先：<氏名> <連絡先メール>
```

### P2b IRいしかわ鉄道 / P5 あいの風とやま鉄道 — A. 本文 (form)

```text
件名：駅の喫煙場所の有無と、アプリへの掲載可否についてのお伺い（<駅名>）

<社名> 御中

<氏名>と申します。<概要>
<駅名>の貴社管理区域に、利用者が使える喫煙所・灰皿があるかをお伺いしたくご連絡いたしました。
設置がない場合はその旨をお知らせいただけるだけでも、誤った案内の防止に役立ちます。

<Common B と 共通の確認事項 Q1〜Q13 をここに貼付>

連絡先：<氏名> <連絡先メール>
```

### P3 金沢百番街 — A. 本文 (route 要確認 first)

```text
件名：館内サービスでご案内の喫煙所情報についてのお伺い

金沢百番街 ご担当者様

<氏名>と申します。<概要>
貴館「館内サービス」で「館外の喫煙所をご利用ください」と金沢駅西口・東口の喫煙所をご案内いただいております。
一方、よくあるご質問では「あんと西1階」に喫煙場所がある旨の記載があり、現在の館内の喫煙場所の有無を確認させてください。
また、西口・東口の喫煙所の管理者をご存じでしたらお教えいただけますと幸いです。

<Common B と 共通の確認事項 Q1〜Q13 をここに貼付>

連絡先：<氏名> <連絡先メール>
```

### P3b 金沢フォーラス (OPA) — A. 本文

```text
件名：喫煙場所情報のアプリ掲載についての許諾のお伺い

株式会社OPA 金沢フォーラス ご担当者様

<氏名>と申します。<概要>
貴サイトの利用上の注意 第7条により、私的使用を超える情報の利用には権利者の承諾が必要と理解しております。
館内に一般のお客様が利用できる喫煙場所がある場合、その事実（場所の説明・利用時間）をアプリに掲載することを
ご承諾いただけるか、お伺いいたします。承諾いただけない場合は掲載いたしません。

<Common B と 共通の確認事項 Q1〜Q13 をここに貼付>

連絡先：<氏名> <連絡先メール>
```

### P4 金沢21世紀美術館 — A. 本文 (short; facts only)

```text
件名：広坂口付近の喫煙コーナーについてのお伺い

金沢21世紀美術館 御中

<氏名>と申します。<概要>
「ご利用案内」で、広坂口付近の喫煙コーナーをご案内いただいております。アプリで正確にご案内するため、
灰皿の設置の有無、利用時間、2027年の休館期間中の扱いについてお教えいただけますでしょうか。

<Common B と 共通の確認事項 Q1〜Q13 をここに貼付>

連絡先：<氏名> <連絡先メール>
```

### P5b 福井市 環境政策課 — A. 本文

```text
件名：福井駅周辺の喫煙所情報の提供と、アプリへの掲載可否についてのお伺い

福井市 環境政策課 御中

<氏名>と申します。<概要>
貴課のページで「御園通り北側にある喫煙所」をご案内いただいておりますが、2023年に駅地下への移設があったと承知しております。
現在の喫煙所の場所・利用時間・管理者についてお教えいただけますと幸いです。

<Common B と 共通の確認事項 Q1〜Q13 をここに貼付>

連絡先：<氏名> <連絡先メール> <電話番号>
```

## 5. Licensing checklist (per answer, before any code)

| Check | Pass condition | If not |
| --- | --- | --- |
| Written answer | Mail/letter, not phone | AMBIGUOUS until confirmed in writing |
| Existence (I1) | The manager itself states the place exists now | Not evidence; referrals stay leads |
| Ashtray (I2) | Stated per place, or "none" recorded | Unknown stays unknown; never inferred from a room label |
| Operation (I4, I6) | Current; closures/relocations listed | Closed places excluded; never revived from old pages |
| Location (I7) | Map/diagram/coordinates **and** permission to use them | `areaApproximate` / facility scope (ADR-0017/0018) with an independently licensed anchor; never MapKit/OSM/Google |
| Rights Q1–Q13 | Classified with the 10-09 runbook classes (APPROVED … NO_RESPONSE) | Publication blocked |
| Credit (Q9) | Exact wording recorded | No release without the credit rendering |
| Third parties (Q11) | No photos, floor maps or logos used | Text facts only |
| Revocation (Q10, Q13) | Stop/deletion duties recorded | Hold |

Permission is never presumed from silence, from a public page or from an earlier answer by another publisher.
`factReference` (ADR-0018 §3) remains a separate basis for publicly stated facts and does not need a letter; a
letter is needed where terms prohibit use (`prohibited`), where the facts are not public, or for maps/coordinates.

## 6. Data intake workflow (after an answer)

1. **Record** — maintainer stores the reply privately; a research note adds per-Q answers and the class, without
   personal details (10-09 runbook).
2. **Classify rights** — `openLicence` / `factReference` / permission-scoped / `prohibited`; a refusal moves an existing
   source to `prohibited` and withdraws its spots.
3. **Review evidence** — existence, ashtray, operation, access and hours per place; contradictions fail closed
   (DATA_POLICY §Contradicting official publications); unknown stays unknown.
4. **Location** — publisher point only if supplied and permitted; else facility/namedZone `areaApproximate` with an
   independent licensed anchor; never geocoding, midpoints, map images or MapKit/OSM values.
5. **Registry entry** — `docs/DATA_POLICY.md` source registry: resource, permission date/basis, scope, conditions,
   credit text, review date.
6. **Implement** — adapter or reviewed fact sheet + minimal synthetic fixture + tests + provenance (separate PR).
7. **Gate** — local pipeline, quality checks and promotion as for every source; `make contract`,
   `make api-validate`, `make security-validate`; existing publication gates unchanged.
8. **Publish** — normal reviewed release; credit renders in the app before release.
9. **Maintain** — re-check on the stated update cycle or source-health schedule; a publisher withdrawal or
   relocation notice withdraws the spot in the next release; follow-ups: one reminder at 30 days, stalled at 60.

No step is done by this document. Production, remote D1 and Cloudflare stay unchanged.

## Method

Official pages fetched 2026-10-14 (JST): Kanazawa city 金沢駅 page and copyright page; the 2014 leaflet text
extracted locally (issuer line only); JR West smoking page, terms and inquiry page; IR Ishikawa policy, inquiry
and 金沢駅 info; 金沢百番街 館内サービス; Forus 利用上の注意 第7条 and contact; 金沢21世紀美術館 利用案内;
あいの風とやま鉄道 top, policy and 富山駅; 福井市 ぽい捨て page. Search snippets and third-party listings
(gltjp, blogs, ecomo, tabelog) were not used as evidence. Not found and not guessed: ハピラインふくい official
URL, 大和 香林坊店 official smoking page, 金沢百番街 operating company/general contact, current desk of the
2014 leaflet issuer.
