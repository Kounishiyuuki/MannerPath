# Tokyo adoption criteria review — what actually blocks publication (2026-10-18)

Baseline `origin/main` `a2411a0`. Input: the Lane 4 Tokyo major-station research of 2026-10-18 (local branch
`research/tokyo-v1-major-station-sources`, not pushed; 0 READY). Review only: no source, adapter, fixture, D1,
Cloudflare or App Store change. Not legal advice; rights readings are engineering readings under D-R.

## Status update (2026-10-18, later the same day)

Superseded counts below are kept as the original review. Since then (all open, not merged):
- **#292** onboarded **14** Chuo ward-run parks, not the 3 parks of the Lane 4 subset: the whole ward-run park list was
  reviewed. The undeclared datum was cross-checked in review (park points 10–145 m from GSI address geocodes, no Tokyo
  Datum offset).
- **#293** wires the address-geocode anchor (ADR-0018 item 5), so "not wired" in §1–§3 no longer holds once it merges.
- **#295** adds batch triage and the building/floor split; its dry run gave 89 anchors from 116 rows (Chuo, Shibuya,
  Toshima, Shinjuku). Shinjuku remains blocked by its information-use clause.
- §5's "fixed 513" alignment and §6's decisions are still open.

## 1. Result

Of 35 listed candidates (Chuo 13, Shinjuku 9, Shibuya 6, Toshima 7; Asakusa adds none), **3 are truly unpublishable** (suspended now), **9 wait on one rights decision**
(Shinjuku), and **23 entries (= 21 spots after the same-anchor rule) are re-evaluation targets**:

- **3 spots** (Chuo parks) are publishable under the **existing** specification; they were held by a datum rule
  that no approved source is held to.
- **18 spots** need **one implementation**: the official-address geocode anchor that ADR-0018 D-A already approved
  but that is not wired.

No research gap is the blocker. The blockers are one over-strict reading, one unwired anchor path, one rights
question and the frozen release corpus (§5).

## 2. Classification of every BLOCKED reason

| Reason (Lane 4) | Class | Why |
| --- | --- | --- |
| paspa京橋・paspa西銀座 suspended; サンカクスクエア suspended from 2026-08-26 | **True ban** | Current publisher contradiction (DATA_POLICY §Contradicting official publications, ADR-0018 §5) |
| Shinjuku site policy limits information use to personal/noncommercial purposes | **True ban unless decided otherwise** | D-R: an explicit restriction of information use fails closed. Whether a free app falls inside it is a rights question (§6) |
| `anchorCRSUnconfirmed` (Chuo park CSV states no datum) | **Existing spec solves** | Approved sources already use undeclared-datum decimals as WGS84-compatible (ADR-0006 §taito.coordinates.v1, SOURCES.md Koto/Kyoto/Minato rows). A facility-scope park anchor is approximate by definition; JGD2000/2011 vs WGS84 is sub-metre. Only Tokyo Datum (~400 m) matters, and it is detectable (§4 R5) |
| "No same-named licensed park point" (城辺橋際緑地帯), "lawful same-facility anchor unconfirmed" (八重洲地下街, ミッドタウン八重洲, THE TOBACCO ×2, TODA BUILDING, Shibuya ×6, Toshima ×6) | **Implementation solves** | ADR-0018 §2 items 4–5 (official address, its geocode) are approved as approximate anchors; `anchor_basis = officialAddressGeocode` exists in migration 0032, but no geocoder is wired. ADR-0011 already reviewed abr-geocoder 2.3.1 (デジタル庁, MIT, PDL1.0 data, local, deterministic) |
| 八重洲地下街: three rooms, one anchor | **Existing spec solves** | Same-anchor rule: one spot named for the rooms. Not a blocker |
| ミッドタウン八重洲 floor 2F vs 3F | **Existing spec solves** | A facility-scope spot claims no floor; the zone text omits the disputed floor |
| paspa宮益坂 1F heated / 2F paper; クランクストリート heated-only | **Existing spec solves** | One spot per anchor; type support stated per source, otherwise unknown |
| Shibuya/Toshima rights "R1 possible, review pending" | **Existing spec solves** | D-R approved first-party municipal pages as `factReference`; only the per-source recorded review (Komatsu format) is missing |
| "Not certified within 1 km", "≥3 new additions per station" | **Not a publication criterion** | No ADR, DATA_POLICY or SPECIFICATION rule; a campaign coverage metric. Must not gate a spot |
| Station centre from N02 line geometry | **Not needed** | Research-only computation; never an anchor, and publication does not need it |

## 3. ADR-0018 use

- **Cross-publication anchors (§2 item 2–3) are under-used.** The Chuo park CSV is the same publisher's CC BY 4.0
  dataset with a per-park point: exactly the "same publisher, separate dataset" anchor. It was refused only for the
  datum.
- **Facility representative points (items 4–5) are unused.** Every non-park Tokyo candidate is a station square,
  building or underground mall with a published address. D-A approved this anchor on 2026-10-11; nothing produces it.
- **factReference is used correctly but expensively.** Komatsu and seven airports show the format. Tokyo needs one
  rights reading per ward site (Chuo, Shibuya, Toshima: three readings), not per candidate.
- **There is no station point dataset.** 国土数値情報 N02 publishes station *lines*, not points; a computed midpoint
  is not "a point the dataset states". Station-side places therefore need the address geocode, not N02.

## 4. Minimum publication requirements (proposed checklist)

A Tokyo candidate is READY when all of these hold, and nothing else is asked:

1. **R1 Existence**: a current first-party page lists this smoking place (not a host, not a third party).
2. **R2 Current**: at `checkedAt`, the same publisher shows no suspension, closure, relocation or ban (D-C).
3. **R3 Rights**: one recorded `factReference` (or open-licence) reading per publisher site; no information-use
   prohibition.
4. **R4 Anchor**: one of ADR-0018 §2 items 1–5, recorded with its source; `areaApproximate` unless item 1.
5. **R5 Datum sanity** (proposed, replaces "CRS confirmed"): an undeclared-datum anchor is used as
   WGS84-compatible, as for the approved sources, and recorded as "datum unstated". Once the address geocode exists,
   it must also lie within 300 m of the host's geocode, which rejects a Tokyo Datum offset (~400 m).
6. **R6 Cardinality**: one spot per distinct anchor.
7. **R7 Unknowns**: hours, tobacco types, access and floor stay unknown unless the page states them for the smoking
   place.

**Can be dropped from the gate:** whole-response hashes of every catalog page (keep the fact page digest only),
1 km / per-station targets, N02 station centres, manual radius dedup (the pipeline's ADR-0008 identity rule already
dedups at import), re-derivation of baseline counts for each batch, and request-letter drafts.

## 5. The fixed 513 corpus

`docs/APP_STORE_CONNECT_ENTRY.md` fixes 「本番 6 ソース / 513 地点」 and the Content Rights declaration rests on
`docs/PRODUCTION_CONTENT_RIGHTS_AUDIT.md` (513 / 6). Eight reviewed airport sources are already in the repository
and still undeployed for that reason (SOURCES.md). Adding Tokyo data before v1.0 is therefore a release decision,
not a data question.

| Option | Steps | Effect |
| --- | --- | --- |
| A. Ship 513, add Tokyo after approval (recommended) | Keep the submission corpus; add a data release after App Review with an audit addendum per new source | No resubmission; data is server-delivered, the app needs no change |
| B. Add before submission | Re-run the rights audit and the 513/6 wording in ASC docs, attribution checks on device | Tokyo visible at launch; delays submission by an audit cycle |

Either way the corpus figure should become "reviewed sources as audited on <date>", so later additions do not
contradict a fixed number.

## 6. Decisions needed

- **Shinjuku (rights).** Fact: the site policy limits information use to personal/noncommercial purposes.
  Uncertain: whether a free, ad-free app distributed on the App Store is noncommercial, and whether the clause covers
  facts. Options: treat as `prohibited` (current, fail closed); or ask the ward for written permission.
- **R5 datum rule** in place of "CRS confirmed" (amends ADR-0018 §2 by decision).
- **Wiring the address-geocode anchor** (abr-geocoder, pinned version, PDL1.0 attribution) for ADR-0018 item 5.
- **Option A or B** in §5.
- **Brand-named rooms** (THE TOBACCO, paspa, クランクストリート): publish under a neutral normalized name
  (「喫煙所（八重洲）」) to respect the no-brand-promotion rule, or exclude.
