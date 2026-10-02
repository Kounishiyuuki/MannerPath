# ADR-0017 — Approximate area locations and independent location confidence

Status: **Accepted — maintainer decision 2026-10-02.** Implemented: see "Implementation" below (migration 0030).

Amends ADR-0012 (location precision vocabulary). Relates to ADR-0006 (publication gate), ADR-0009 (relocation),
ADR-0010 (OSM) and ADR-0011 (derived coordinates, still Proposed).

## Context

ADR-0012 already separates existence evidence from location precision, but every precision value it defines is a
point claim (`publisherPoint`, `reviewedDerived`, `communityPinned`) or `unknown`. In practice
(`NATIONWIDE_DATA_STRATEGY.md` §12) many accepted official listings say only that a smoking place is **inside** a
named park, station, facility, airport or commercial building, with no point for the smoking place itself. Treating
"no exact coordinate" as a publication blocker hides places whose existence is well evidenced; inventing a point
would create false confidence. Neither serves the coverage-first model.

## Decision

1. **New location precision `areaApproximate`.** It means: accepted evidence places the smoking place inside a
   specific area or host (park, station, facility, airport, commercial building), and the point of the smoking place
   itself is unknown. The spot's pin is a **reviewed, reusable representative anchor** of that area/host.
2. **Missing exact coordinates alone never reject a spot** that has accepted smoking-place existence evidence. With a
   reviewed anchor it is a publishable candidate at `areaApproximate`; without one it stays unpublished (there is
   nothing honest to draw) but is not discarded as evidence.
3. **Existence evidence is still required.** The area/host is location context, never existence evidence: a park,
   station or facility existing proves nothing about a smoking place (ADR-0006, ADR-0012 decision 7). Evidence tiers
   are unchanged.
4. **Anchors need provenance and reuse review**, like any canonical value: source, reuse terms and the review that
   chose the anchor are recorded. Forbidden as anchors: Google/Apple POI coordinates, OSM values (ADR-0010),
   coordinates read off map screenshots, and arbitrary manual guesses. A reviewed representative point from a
   reusable source (for example a reviewed official facility location, or a reviewed ADR-0011 geocode of the host's
   official address once that policy is approved) is acceptable.
5. **Never disguised as exact.** An anchor is never labelled `publisherPoint`, and a polygon centroid or host centre
   is never presented as the smoking point. UI: list 「位置は○○内の目安です」; detail 「喫煙場所はこの施設/公園内に
   あることが確認されています。正確な位置は未確認のため、ピンは目安です。」; navigation 「この付近へ案内」 instead of
   「この場所へ案内」; distance may read 「約○m」. VoiceOver, widgets and Watch say the same.
6. **Upgrades keep identity.** When a publisher point, community pin or approved derived coordinate arrives, the
   same spot ID is kept. If the canonical coordinate is unchanged, only the location-precision metadata changes. If
   latitude or longitude changes at all, the coordinate mutation follows ADR-0009's reviewed relocation/application
   path, with no distance threshold, even when the new point stays inside the same area. The product-level reason may
   be "precision upgrade", but it never bypasses ADR-0009. A new point outside the original area additionally needs
   review of the area/identity premise itself and is never upgraded automatically.
7. **Ranking/filters** may treat approximate distance as approximate but must not hide the spot for it.

## Example

Municipality: 「○○公園内に喫煙所があります」. Smoking-place coordinate: unknown. Reviewed reusable park anchor:
available. Result: `existence = official`, `locationPrecision = areaApproximate`, publishable candidate.

## Relationship to ADR-0011

ADR-0011 governs turning an **address** into a point and remains Proposed; its rule "an address-only source is not
geocoded into a published spot" still stands. ADR-0017 does not approve geocoding. It only allows a reviewed anchor of
an area/host to stand as an explicitly approximate pin.

## Implementation (2026-10-02, revised after review)

**Schema (migration 0030).** Four tables, every one append-only. Each has a BEFORE INSERT trigger refusing a row whose
key or unique digest already exists, so `INSERT OR REPLACE` cannot rewrite one (SQLite's REPLACE deletes without firing
DELETE triggers while `recursive_triggers` is off); UPDATE and DELETE are refused outright.

- `area_location_anchors`: one reviewed anchor bound to **one publication** — the origin release (content digest) and
  the record in it that states the area's point, with that record's verbatim values. `recordAreaAnchor` resolves the
  record by publisher row reference and checks the registry's coordinate against it through the adapter's reviewed
  `areaPoint` mapping, so no coordinate is typed or guessed. The origin source must be an approved official/operator
  source. Map-vendor/OSM/screenshot references are refused as defence in depth only.
- `spot_location_anchors`: the binding, written by the resolver in the spot's batch, citing the existence record and
  its release digest. **Anchor policy v1 = same publication**: the binding's release is the anchor's release (checked in
  code and in the schema), so `parks.csv` cannot anchor `list.csv`, and an anchor of release A cannot pin a spot first
  listed in release B. A binding has no end state.
- `area_precision_upgrades`: **the only authority for leaving areaApproximate (review question 1).** It records the
  exact-point evidence (source, release digest, record, observation, mapping, the evidence's own location rule and
  columns, the exact coordinate), the reviewed identity (the evidence record's ambiguousMatch item and its latest
  matchedToEntity decision), the target precision, the area premise, and for a moved point the ADR-0009 relocation item
  and decision. Its triggers re-check every premise against live rows: the spot is still pinned at the anchor, the
  observation states a non-anchor point at exactly the new coordinate, the identity decision is the latest, and a moved
  point is exactly the current, actionable relocation (`review_relocation_application_premises`: latest
  relocationConfirmed, this item's own unconsumed hold, no competing hold, current comparison). Its spot's final
  precision is the upgrade's `target_precision`; its final location provenance must be exactly the upgrade's evidence
  (record, rule, columns); nothing is inferred from a binding alone.
- `area_anchor_relocation_deltas`: runtime audit that admits exactly one extra delta into ADR-0009's relocation premise
  for one relocationCandidate — the anchor claim disappears and the location provenance entry changes from the spot's
  own anchor rule to a non-anchor rule, every other provenance entry and claim identical. It is validated by its own
  triggers (each its own program, within D1's expression depth limit; checked on local D1).

**Final state after a move (review question 1).** `applyAreaPrecisionUpgrade` writes, in one batch, the delta, the
upgrade and the ADR-0009 `review_relocation_applications` row (whose trigger moves the spot). The anchored-pin trigger
lets an anchored spot move only to exactly its relocated upgrade's coordinate. When the release is applied, the resolver
replaces the location provenance with exactly the upgrade's evidence (a provenance trigger refuses anything else) and
moves the remaining evidence as for any reviewed match. Between those two steps the location state is invalid and the
spot is not published. After them the spot is `publisherPoint` at the exact point, with the same spot ID; the anchor,
binding, upgrade, delta and relocation rows remain as history.

**Outside the area (review question 2).** v1 fails closed. `area_premise` admits only `insideArea`, which the reviewer
attests alongside the reviewed identity and relocation decisions. An outside-area or unknown premise has no
representation, the planner and executor refuse it, and an anchored pin cannot move without an upgrade row. A
community pin target (`communityPinned`: cross-source evidence under #124) and `reviewedDerived` (ADR-0011 Proposed) are
refused the same way.

**Publication invariant (one logic).** `src/tiles/location-state.ts` decides every spot's location state from the same
columns for tile publication, spot detail, the quality check `area-anchor-never-exact` and promotion v2/v3/v4
validation. It works in both directions: a binding without an upgrade needs exactly its anchor rule, source, publication
and coordinate. An upgrade needs exactly its exact evidence and coordinate. An anchor rule without a binding, or any
mismatch, is invalid: never published, served or promoted.

**Promotion.** v2/v3/v4 carry the anchors, upgrades and bindings of published spots, selected by source rather than by
current release. An anchor or binding may cite an earlier release that the bundle does not carry (a raw-identical next
release keeps the spot's binding). Those columns travel as attested values: they are checked against real rows whenever
that release exists, and accepted as an attestation only while a promotion bootstrap is open (the
`promotion_review_match_attestations` model), never presented as the current release. Bindings precede
`spot_field_provenance` in the bundle; an area-anchor location row needs its binding. The v4 per-part validator reads
each spot's location-state closure in a bounded way. Round-trips are tested for each state:
- active anchor;
- same-coordinate upgrade;
- moved upgrade;
- an anchor from an earlier release.

Each state is tested in v2, v3 and v4, through fresh GREEN, republish and byte-identical re-export.

**Wire and clients.** The wire contract is unchanged: `locationPrecision: "areaApproximate"` plus `locationArea`. The
clients say 「この場所へ案内」 only for `publisherPoint` and `communityPinned`; an area anchor, `reviewedDerived`, unknown,
an unrecognised value or a legacy spot without precision gets 「この付近へ案内」 (iPhone and Watch share one rule).

**Ranking: no new factor** (`nearby-ranking.v2` unchanged). The distance to an anchor is uncertain in both directions, so
a penalty would bias against evidenced, mostly official places; the uncertainty is shown instead (「約」, the list note).
Approximate pins are never hard-filtered.

**Replay.** `npm run replay:approximate` → `docs/research/2026-10-02-approximate-location-replay.md`.

## Remaining follow-ups

- Anchor policy v2 for same-publisher separate datasets (with that dataset's attribution in tiles), then real anchors.
- An outside-area upgrade path (identity/area re-review) and community-pin upgrades, each with its own decision.
- Reuse-rights reviews for the replay's location-eligible targets.
