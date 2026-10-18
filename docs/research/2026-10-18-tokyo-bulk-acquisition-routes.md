# Tokyo bulk acquisition routes — toward 2,000+ spots (2026-10-18)

Baseline `origin/main` `a2411a0`. Research only: no source registered, no data imported, no scraping of third-party
services, no publisher or vendor contacted (drafts in §6 are unsent). Not legal advice.

Counts are of two kinds and are never added together: **candidates** (what a route could contain) and
**lawfully publishable** (an estimate under the current rules or a stated change). "Measured" means read from a primary
or cited document on 2026-10-18; everything else is labelled as an estimate with its basis.

## 1. Result

- **One survey counts 641 ward-run + ward-designated public smoking places in the 23 wards** (PlanWorks 政策研究所,
  2026-05). It is not a ceiling: it excludes Tama, private places outside ward designation and changes since, and ward
  lists differ from it (§3). MannerPath publishes 149 such places (Taito 32, Minato 114, Koto 3) and PR #292 adds 14. Public lists alone are
  unlikely to reach 2,000.
- **Only one route can reach 2,000 by itself: licensed restaurant/café smoking data** (Retty Food Data Platform,
  whose case page says CLUB JT's map holds ≈78,000 restaurant smoking spots nationwide — an undated figure for JT's
  product, **not** what Retty can license to MannerPath, and not a Tokyo count). It needs a contract **and** an ADR, because a licensed aggregator is
  still third-party discovery under AGENTS.md.
- Without that contract, the realistic Tokyo total is **≈1,100–1,900** (§4), not 2,000.
- **Start now:** (1) wire the address-geocode anchor and onboard the remaining ward lists; (2) send the Retty and chain
  inquiries; (3) request notification statistics from the health centres.

## Status (2026-10-18, after PRs #292, #293, #295 opened)

Open, not merged: #292 (14 Chuo parks), #293 (address-geocode anchor, ADR-0018 item 5), #295 (batch triage, building/
floor split; its dry run: 89 anchors from 116 listed rows of Chuo, Shibuya, Toshima, Shinjuku). Phase 1 below assumes
#293 and #295 merge; until then the R1 estimate is not reachable. Shinjuku stays blocked by its information-use clause.

## 2. Route comparison

| # | Route | Candidates (Tokyo) | Lawfully publishable (estimate) | Rights | Position | Update | Dev cost |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| R1 | 23-ward public lists (factReference + address anchor) | **641** measured (PPI table, §3) | **≈420 new** (641 − 149 published − Shinjuku 32 − ≈5 % suspended/no address) | D-R factReference per ward site; Shinjuku restricts information use (fails closed); Chiyoda's map images forbid secondary use but its site terms allow reuse of text | `areaApproximate` (address geocode, ADR-0018 item 5) or publisher point where a dataset exists | Page fingerprint (source health) | **M once** (geocoder), **S per ward** (≈20 adapters) |
| R2 | Tama 26 cities + town lists | Not measured | 50–150 (estimate: Musashino 3 already; station-front lists are small) | As R1 | As R1 | As R1 | S per city |
| R3 | Restaurant/café smoking data, **Retty FDP** (contract) | Unknown: the only figure is ≈78,000 nationwide on CLUB JT's map (Retty case page, undated); Retty's own licensable set and Tokyo share are not published — 7,800–15,600 if Tokyo is 10–20 % | **0 today**; with a contract that allows storage, offline cache and redistribution in tiles: thousands | Monthly-fee B2B licence (Retty disclosure); terms unknown | Restaurant point (vendor) → must be shown as venue point, not a booth | API, continuous; decay risk (smoking status changes) | **L**: contract, new evidence tier (ADR), freshness model |
| R4 | Chain official store data (cafés with smoking rooms) | Doutor 486 Tokyo stores (measured, official locator); share with smoking rooms unknown | 0 today; with written permission 200–600 (estimate across Doutor/Renoir/Komeda/others) | First-party operator: D-R applies to pages; the locator is a NAVITIME-hosted app, bulk retrieval needs permission | Operator point or address anchor | Chain feed or page check | M per chain |
| R5 | HotPepper Gourmet API | Large; `non_smoking` field per shop | **0** | Terms forbid copying into a third party's database, editing/processing, and require cache refresh within 24 h | — | — | Not pursued for canonical data |
| R6 | Smoking-data companies (CLUB JT, moqlog, tobacco.tokyo) | CLUB JT ≈80,000 nationwide incl. Retty; tobacco.tokyo claims 24,096 Tokyo (inconsistent with its own 6,953 page) | 0 | CLUB JT is a tobacco maker's service (brand/promotion rule); moqlog: no licence (2026-10-14 review); tobacco.tokyo: provenance unknown | Host points | — | Lead-only at most |
| R7 | Business self-registration + community | Open | 200–500 in year one (assumption: outreach to venues, verification by phone/document) | MannerPath terms (#124 pending) | Venue-pinned (`communityPinned`) | Continuous | M: terms, verification, moderation |
| R8 | OSM, isolated database (ADR-0010 architecture B) | 271 `amenity=smoking_area` in Tokyo (measured 2026-10-04); venue `smoking=*` tags not counted | ≈150–250 after dedup with R1, **only after legal review** | ODbL share-alike on the separate DB; §4.6 offer | OSM point, unverified | OSM diffs | L: separate DB, tiles, export offer |
| R9 | Information disclosure of 喫煙可能室 notifications (health centres) | **Not published** (no count found for Tokyo or any ward) | Unknown; first ask for statistics | Administrative documents: facts usable; sole-proprietor data may be withheld | Address anchor | One-off; stale (closures not always notified) | M: requests, fees, months |

## 3. Evidence for the numbers

- **R1 per ward** (PPI table, 既存設置数 = 行政直営 + 行政指定): 千代田 82, 中央 76, 港 113, 新宿 32, 文京 8, 台東 32,
  墨田 8, 江東 22, 品川 18, 目黒 13, 大田 11, 世田谷 44, 渋谷 60, 中野 9, 杉並 14, 豊島 7, 北 14, 荒川 10, 板橋 14,
  練馬 9, 足立 19, 葛飾 20, 江戸川 6; total **641**. The same report estimates 2,543 *needed*; that is a policy target,
  not existing places. Ward-level counts differ from current ward lists (Chuo lists 21 ward-run + private places;
  Minato 116), so each adapter re-counts from its own page.
- **Already published**: 149 (six-source baseline). PR #292: 14 Chuo parks (open, not merged).
- **R3**: Retty case page for CLUB JT: 「約78,000件」 restaurant smoking spots registered on CLUB JT's map (undated; the
  count of a JT product built with FDP, not an offer to MannerPath), delivered by API, attributes include where
  smoking is allowed and tobacco type; sourcing method not stated. Retty's securities report: FDP is a monthly-fee
  data feed.
- **R4**: Doutor official store search lists 486 Tokyo stores; its search has no smoking filter, so the smoking-room
  share must come from the operator.
- **R5**: Recruit Web Service terms (禁止行為, 権利関係の帰属, 更新の義務).
- **R8**: `2026-10-04-osm-smoking-viability.md` (Tokyo 271 of 1,030 national core).

## 4. Collection plan

| Phase | Work | Expected Tokyo total | Gate |
| --- | --- | ---: | --- |
| 0 (now) | Baseline 149 + PR #292 | 163 | — |
| 1 (≈6 weeks) | Wire abr-geocoder as the ADR-0018 item 5 anchor; onboard the 19 ward lists with ≥6 places first (千代田, 渋谷, 世田谷, 江東, 葛飾, 足立, 品川, 杉並, 北, 板橋, 目黒, 大田, 荒川 …) | ≈580 | Geocoder decision (PR #291 §6) |
| 2 (send now, results 1–3 months) | Retty FDP inquiry; chain inquiries (Doutor, Renoir, Komeda, Excelsior, Tully's, Gusto group); disclosure request for notification statistics | +200–600 chains → ≈800–1,200 | Written permissions |
| 3 (with contract) | ADR "licensed aggregator" evidence tier (shown as such, own confidence, `checkedAt`, decay rule); Retty import | **2,000+** | Contract terms allow DB, offline, tiles |
| 3′ (without contract) | Business registration + community (#124); OSM isolated DB after legal review | ≈1,100–1,900 | #124, ADR-0010 legal review |

Venues are never evidence by themselves: R3/R4 records must state smoking is permitted (room, seat or 喫煙可能店) for
that venue; a chain or restaurant without that statement is excluded. Restaurants remain subject to the Tokyo
ordinance (喫煙可能室 only in small existing no-employee venues), so status changes are expected and must decay.

## 5. Decisions needed

1. Contact Retty and the chains (drafts below)?
2. Accept a **licensed aggregator** evidence tier in principle (ADR)? Without it R3 cannot publish even under contract.
3. Geocoder wiring (PR #291 §6) — the precondition for Phase 1.
4. Disclosure requests to health centres (cost and time).

## 6. Draft inquiries (not sent)

**Retty Food Data Platform** — https://campaign.retty.me/fooddataplatform/form/fdp_contact_form.html

> 件名：Food Data Platform 喫煙情報データの利用条件について
>
> 喫煙が認められた場所を案内する無料の iPhone / Apple Watch アプリ「MannerPath」を開発しています（たばこの販売・
> 広告は行いません）。東京都内の飲食店・喫茶店の喫煙可否データの利用を検討しており、次の点を伺えますでしょうか。
> 1. 提供可能な項目（喫煙可否、喫煙室・喫煙席の種別、紙巻き／加熱式、確認日）と東京都内の件数
> 2. 喫煙情報の取得方法（店舗申告・編集部確認・ユーザー投稿の別）と更新頻度
> 3. 当方データベース（Cloudflare D1）への保存、端末内オフラインキャッシュ、アプリ内地図タイルでの表示の可否
> 4. 必要な出典表示、料金体系、契約期間終了時のデータ削除条件
> ご検討のほど、よろしくお願いいたします。

**Chain operators (template)** — each company's official inquiry form

> 件名：店舗の喫煙設備情報の掲載可否について
>
> 喫煙が認められた場所を案内する無料アプリ「MannerPath」です。貴社店舗のうち喫煙室・喫煙席を設けている東京都内の
> 店舗について、店舗名・住所（または緯度経度）・喫煙設備の種別（紙巻き／加熱式）を、出典を明記のうえアプリに掲載
> してよいか、またその一覧をご提供いただけるかを伺えますでしょうか。ブランドの宣伝やたばこの販売促進は行わず、
> 情報の変更・削除のご連絡には速やかに対応します。

**Health centres (statistics, not lists)** — 各区保健所 / 東京都保健医療局

> 件名：喫煙可能室設置施設の届出件数について
>
> 受動喫煙防止条例に基づく喫煙可能室設置施設の届出について、区内（所管内）の現在の届出件数と、届出施設名・所在地を
> 公表または情報公開請求で開示いただけるかを伺えますでしょうか。
