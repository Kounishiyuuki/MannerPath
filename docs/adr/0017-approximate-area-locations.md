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

## Implementation (2026-10-02)

- **Schema (migration 0030).** `area_location_anchors`: one immutable, reviewed anchor — area name and kind,
  coordinate, `origin_kind` (`publisherAreaPoint` / `publisherFacilityPoint`), `origin_source_id`, `origin_reference`,
  `reuse_basis`, `policy_version`, reviewer and date, bound by `evidence_sha256`. A trigger refuses Google/Apple
  Maps, OSM/Overpass/Nominatim and screenshot references; the origin must be a reviewed official or operator source.
  `spot_location_anchors`: one binding per spot (the spot ID is stable), written by the resolver in the spot's own
  batch, at exactly the anchor coordinate; it ends only with a reason and is never deleted. Both tables travel in
  promotion v2/v3/v4 and are named by every empty-target guard.
- **Anchor policy v1** (`area-anchor-policy.v1`): the anchor comes from the existence source's own reviewed
  publication (`reuse_basis = existenceSourceLicense`), so the tile's existing source attribution covers it. An anchor
  from a separate dataset, even of the same publisher, needs a policy v2 that also carries that dataset's attribution.
- **Resolver and publication.** An adapter states an anchored observation with `anchoredObservation` (the existence
  provenance is required; the `location` provenance names `area-anchor.v1:<anchorId>`). The resolver refuses an
  unrecorded anchor, an anchor of another source or a coordinate mismatch before any canonical write. Publication
  fails closed for a spot whose location cites an anchor without a binding. The gate is `evaluateAreaApproximate`
  (`area-approximate-gate.v1`): existence first (host-only, no evidence, not approved, closed/prohibited and
  conflicting evidence reject); a missing exact point alone never rejects; a missing anchor withholds without
  discarding the evidence.
- **Wire.** `verification.locationPrecision = "areaApproximate"` plus `verification.locationArea` (name, kind),
  present exactly then. Every other spot's bytes are unchanged (golden tile bodies identical).
- **Quality.** `area-anchor-never-exact` fails if an anchored spot is published as anything else, or anything else
  as `areaApproximate`. Coverage tasks ask for a location check on approximate pins.
- **Precision upgrade** (`planAreaPrecisionUpgrade`, `applyAreaPrecisionUpgrade`): same coordinate → the binding
  ends as `precisionUpgrade` with the new precision (`publisherPoint` / `communityPinned`; `reviewedDerived` is
  refused while ADR-0011 is Proposed). Any coordinate change → ADR-0009 relocation review (the 0015 trigger already
  refuses any unreviewed coordinate change, and 0030 adds that an anchored pin cannot move until its binding has
  ended as `relocationReview`, which itself needs an ADR-0009 relocation hold). Outside the area also re-reviews
  identity.
- **Clients.** iPhone list 「位置は○○内の目安です」 (or 「位置はこのエリア内の目安です」 without a showable name),
  detail note, 「この付近へ案内」 vs 「この場所へ案内」, 「約○m」, VoiceOver on list rows and map pins; Watch snapshot
  carries the precision and area (older snapshots decode as not approximate) with the same copy; iPhone widget
  reads 「約○m先・位置は目安」, Watch widget 「位置は目安」. Spots cached before ADR-0017 decode unchanged.
- **Ranking: no new factor** (`nearby-ranking.v2` unchanged). Distance to an anchor is uncertain in both directions
  (the place may be nearer or farther than the anchor), so a penalty would be a systematic bias against evidenced,
  mostly official places, not a correction; the uncertainty is shown instead (「約」, the list note). Approximate pins
  are never hard-filtered, and "confirmed only" filters on existence, not precision.
- **Replay.** `npm run replay:approximate` → `docs/research/2026-10-02-approximate-location-replay.md`.

## Remaining follow-ups

- Anchor policy v2 for same-publisher separate datasets (with attribution), then real anchors.
- Reuse-rights reviews for the replay's location-eligible targets.
