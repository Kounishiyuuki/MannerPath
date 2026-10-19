# v1.0 Tokyo additions — rights review sheet (input to G5; NOT an approval)

This sheet collects, per source, the evidence the maintainer needs for the App Store Content Rights answer for
the 125 spots from 5 Tokyo sources. It **does not approve anything**.

- `factReference` is an engineering classification (ADR-0018 D-R), not legal clearance.
- `publicationStatus: approved` in `services/api/src/pipeline/registry.ts` is the pipeline's reviewed-entry flag.
  It is **not** a legal decision and does not settle any row below.
- Production does not serve these sources (2026-10-19).

All facts below come from each source's `PROVENANCE.md` and the registry entry, as committed. The live pages
were not re-fetched for this sheet.

## 1. What MannerPath stores and shows (all 5 sources)

- **Stored (normalized fact CSV in the repository).** One row per place: place name, zones, hours text and its
  note, the source page URL, the checked date, and an anchor point with its basis and reference. Some sources
  also store area name/kind/scope and spot/access/environment/host type. chuo-private stores the official
  address instead.
- **Not stored or redistributed.** Page HTML, prose, images, maps, PDFs, screenshots and logos. Page hashes
  are recorded; the HTML stays outside the repository.
- **Shown in the app.** The place name, hours as text (the explicit 24-hour Chuo rows parse as allDay), the
  approximate anchor labelled 目安, and the source name with its attribution text and page link.
- **Anchor data.** Every anchor is either an ABR address point (デジタル庁 アドレス・ベース・レジストリ, 公共データ利用規約 第1.0版) or, for chuo-park, a Chuo-ku park point (CC BY 4.0). Neither comes from the ward page.

## 2. Per source

| Source (spots) | Existence page | Site terms as recorded | Prohibitions recorded | Attribution shown (registry) | Engineering reading |
| --- | --- | --- | --- | --- | --- |
| chiyoda-smoking-places (30) | 千代田区「無料喫煙所（公衆喫煙所）のご案内」 | 千代田区ホームページ利用規約: anyone may copy and adapt content, **commercial use included**, with a source credit and an "edited" statement | Photos, video and illustrations are excluded. The SMOKING AREA MAP page's map images may not be reused (not used) | 「出典：…を加工して作成（2026-10-19確認）」 + ABR credit + no-endorsement | Strongest of the 5: the terms expressly permit reuse, and the credit says 加工 |
| chuo-park-smoking-places (14) | 中央区「中央区内指定喫煙場所一覧」(区営) | 「著作権について」: copyright reserved | **Unauthorized 転載・改変 forbidden**. No prohibition of information use or database incorporation found | 出典 page + CC BY 4.0 park-list modified-work credit + no-endorsement | Facts only. Relies on facts not being the page's protected expression |
| chuo-private-smoking-places (47) | the same page (民間) | as chuo-park | as chuo-park | 出典 page + ABR named, but **no licence name for ABR** (the other ABR users name 公共データ利用規約 第1.0版) + no-endorsement | As chuo-park. Also see open points 4 and 5 |
| shibuya-smoking-places (30) | 渋谷区「区内公共喫煙所一覧」 | サイトポリシー「著作権について」: the ward holds copyright in the information, images and figures | **転載・複製 without contacting the ward forbidden**. No prohibition of information use found | 出典 page + ABR credit + no-endorsement | Facts only. The terms point to contacting the ward |
| toshima-smoking-places (4) | 豊島区「区指定喫煙所」 | サイトポリシー「著作権について」: the ward holds the rights in its documents and images | **無断で複製・転用 forbidden** outside private use or quotation. No prohibition of information use found | 出典 page + ABR credit + no-endorsement | Facts only. The terms list exceptions that do not obviously cover an app |

Reference pages and recorded SHA-256 values are in each
`services/data-pipeline/fixtures/<source>/PROVENANCE.md`.

## 3. Open points (maintainer decides; none is resolved here)

1. **Chuo, Shibuya and Toshima: "facts are not the page's expression."** Their terms forbid 転載・改変, 転載・複製 or
   複製・転用 without permission. MannerPath stores normalized facts and does not reproduce prose, layout or images.
   Whether a list of places, hours and addresses is outside the protected work, including any database or
   compilation protection of the list, is the legal judgement G5 needs. Options:
   - (a) sign off on the facts-only reading;
   - (b) ask the ward first (the Setagaya inquiry draft can be adapted; Shibuya's terms invite contact);
   - (c) ship 1.0 without that ward's spots.
2. **Name fidelity.** Place names are copied as published. For private places they are business or building
   names. A short name is generally not protected expression, but this is part of (1).
3. **Toshima/Shibuya brand names.** THE TOBACCO IKEBUKURO, THE TOBACCO SHIBUYA SECOND and other names come from
   ward lists. Ploom LOUNGE 渋谷 was already excluded under the no-brand-promotion rule. Decide whether ward-listed
   smoking spaces whose names include a retailer's name are acceptable for App Review (Guideline 1.4.3 risk),
   independent of rights.
4. **chuo-private access.** Access type is unknown for 47 private places listed by the ward, some possibly
   customer-only. This is shown honestly as unknown. Confirm that this is acceptable for the 1.0 claim
   "利用条件を確認できた場所のみ".
   - The store copy's wording was written for the open-data sources, whose terms of use were confirmed.
   - For chuo-private, "利用条件" in the copy means the publisher's terms, not access to the place. The draft
     uses that meaning; confirm it is not misleading.
5. **chuo-private ABR credit.** The attribution names ABR but not its terms (公共データ利用規約 第1.0版). The other
   four ABR-anchored sources name them. Adding them is a registry and attribution change (a separate small PR,
   with tests), and it does not need a legal decision.
6. **Publisher objection path.** ADR-0018 D-R fails closed on objection. Confirm that the support address is
   monitored and that a takedown can be released quickly: a source hold plus a promotion, not an app update.
7. **App Store Content Rights answer.** It stays "Yes, contains third-party content". The necessary-rights
   declaration covers the 125 spots only after points 1–4 are decided. If any ward is excluded, the 638 copy and
   `TOKYO_AREAS` must drop that ward. Chuo has two sources, so excluding Chuo removes both.

## 4. If a ward is excluded

| Excluded | Published | Copy change |
| --- | --- | --- |
| none | 638 | V1_TOKYO_STORE_COPY.md as written |
| Toshima | 634 | remove 豊島区 |
| Shibuya | 608 | remove 渋谷区; 渋谷/新宿 station coverage → 0 |
| Chuo (both) | 577 | remove 中央区 |
| Chuo + Shibuya + Toshima (keep Chiyoda only) | 543 | 千代田区 only added |
