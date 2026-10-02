# ADR-0017 — Approximate area locations and independent location confidence

Status: **Accepted — maintainer decision 2026-10-02.** Specification only: nothing is implemented by this ADR.
Implementation follow-ups are listed below and in `docs/SPECIFICATION.md` §25.

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
   same spot ID is kept and the precision upgrades; this is a precision change, not a relocation, unless the new
   point falls outside the area (then ADR-0009 review applies).
7. **Ranking/filters** may treat approximate distance as approximate but must not hide the spot for it.

## Example

Municipality: 「○○公園内に喫煙所があります」. Smoking-place coordinate: unknown. Reviewed reusable park anchor:
available. Result: `existence = official`, `locationPrecision = areaApproximate`, publishable candidate.

## Relationship to ADR-0011

ADR-0011 governs turning an **address** into a point and remains Proposed; its rule "an address-only source is not
geocoded into a published spot" still stands. ADR-0017 does not approve geocoding. It only allows a reviewed anchor of
an area/host to stand as an explicitly approximate pin.

## Implementation follow-ups (not done)

- Add `areaApproximate` to `verification.locationPrecision` (D1 CHECKs, DTOs, API schemas, Swift `Domain/Verification`).
  Old clients must read the unknown value through their existing fallback, never as exact.
- Anchor registry with provenance/reuse review; resolver path for evidence + anchor; quality check that an anchor is
  never `publisherPoint`.
- Client copy and accessibility per decision 5; precision-upgrade path per decision 6.
- Re-run the coverage replay to count newly eligible research targets.
