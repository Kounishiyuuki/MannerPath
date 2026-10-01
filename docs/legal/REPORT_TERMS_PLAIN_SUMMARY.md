# Report terms candidate — plain-language summary for the maintainer

For deciding Issue #124. This explains `docs/legal/REPORT_TERMS_CANDIDATE.md` in plain words. It is **not legal
advice** and does not say the candidate is legally sufficient; whether to get a lawyer's review is part of the decision.

## What a contributor agrees to, in one paragraph

"If MannerPath's reviewers accept my report, MannerPath may keep and publish the **reviewed facts** that came out of
it (where the place is, what kind of place, whether it still exists) as MannerPath data, everywhere MannerPath
distributes data, for free and permanently. My note and anything that points to me are never published and are
deleted within 90 days. My report might not be used at all, and it will be shown as a reviewed user report, not
as official information."

## Rights, item by item

| Need (why MannerPath needs it) | In the candidate | Deliberately NOT taken |
| --- | --- | --- |
| Store and moderate the report | §2 | — |
| Normalize it (round the pin, convert choices to structured fields, merge duplicates) | §2, §4.1 | — |
| Publish via app, Watch, API, tiles, promotion/export bundles | §4.1 | — |
| Convert to future formats | §4.1 | — |
| Third parties reusing MannerPath data | §4.2 — **your choice** (allow / allow with attribution / don't allow) | — |
| Commercial use | not mentioned separately; follows §4.2's choice | No sale of contributor data is described or needed |
| Free text (notes) | — | §4.3: notes are never licensed or published |
| Personal / anti-abuse data | — | §5: never published, §6: deleted within 90 days |
| Contributor credit by name | — | §7: no names, no IDs; attribution is "MannerPath 利用者報告（審査済み）" |

"Irrevocable" in §4.1 matters: without it, every withdrawal request could force unpublishing a fact that other
people also confirmed. Whether you want that is exactly the withdrawal decision below.

## What stays as placeholders (`MAINTAINER-INPUT`)

The repository records no operator name, contact address, governing law or public terms URL, so none was invented:

1. Operator name (§ header)
2. Third-party reuse / commercial use (§4.2)
3. Withdrawal wording (§8) — pick option A, B or C in `COMMUNITY_PUBLICATION_DECISION.md`
4. Liability wording (§10)
5. Governing law, court, contact point, public terms URL (§11)

The activation test refuses an approved document that still contains `MAINTAINER-INPUT`, `DRAFT` or `CANDIDATE`.

## What changes for people who already consented to the draft

Nothing. The draft told them nothing would be published on it. The approved terms are a **new version**; only
reports that explicitly agree to that new version can ever be published. Draft-consented reports stay usable as
review signals only.
