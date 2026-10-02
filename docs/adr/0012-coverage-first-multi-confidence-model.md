# ADR-0012 — Coverage-first multi-confidence smoking-place model

Status: **Accepted** (2026-10-01, maintainer decision; Issue #143, child of #67).

Implementation: migration `0023_coverage_first_multiconfidence.sql`; `services/api/src/tiles/{dto,publish}.ts`
(`verification`), `src/pipeline/community-{adapter,reconciliation,verification}.ts`, `src/quality/{analyze,freshness,coverage-replay}.ts`;
Apple `Domain/Verification/`, `Domain/Search/NearbySearch.swift`, `Features/Nearby/`, Watch `WatchSnapshot.swift`.

This ADR does **not** approve Issue #124 (report terms / publication rights), does not approve the community source,
and does not approve ADR-0011's derived-coordinate publication policy (still Proposed). It makes lower-confidence
data *technically* publishable; each rights gate stays exactly where it was.

## Context

Until now trust was binary: a spot was published (it passed ADR-0006) or it did not exist for users. Nationwide
research (#138, #139, #142; `docs/research/nationwide-discovery/2026-10-01-coverage-replay.json`) shows why that
cannot reach nationwide usefulness on official data alone: of 61 reviewed research targets, 33 are blocked only
because official open data does not carry the smoking place at all (a host facility, no smoking category, no
coordinate), and a large class of real places — convenience-store side ashtrays, small smoking corners, cafés and
kissaten where smoking is permitted, customer-only spaces — never appears in official open data.

The maintainer's decision: MannerPath is **not** "an app that shows only certain spots" but **"an app that finds as
many permitted smoking places as possible and tells you how far each one can be trusted"**. False confidence stays
forbidden; lower-confidence data does not.

## Decisions

1. **Lower-confidence spots may be visible.** A spot whose existence rests on a single moderated community report
   may be published as `communityReported` once its rights basis is granted. It is labelled as such everywhere.
2. **The evidence class is explicit.** Every published spot carries `verification.existence`:
   `official` (a reviewed official/public listing), `operator` (a reviewed operator source), `communityVerified`
   (≥ 2 independent moderated submitters, or a reported spot later confirmed by an independent submitter),
   `communityReported` (one moderated, consented, explicitly classified report). `evidenceQuality` keeps its
   meaning; v3 adds `communityReported`, `communityVerified` and `operatorListing` (v2's `communityReviewed` reads
   as `communityVerified`). A single community report is never presented as official.
3. **Location precision is separate from existence evidence.** `verification.locationPrecision`:
   `publisherPoint`, `reviewedDerived` (ADR-0011, not yet approved for publication), `communityPinned`, `unknown`.
   "Exists" and "the pin is exact" are different questions.
4. **Stale ≠ nonexistent.** Freshness (`freshness.v1`: fresh ≤ 365 days, aging ≤ 730, then stale; unknown without a
   date) is a label and a ranking factor, never a publication gate. Only removal/negative evidence through the
   existing review, hold and removal machinery withdraws a spot.
5. **Official is not the only publishable source.** Official data remains the preferred evidence; community data can
   be published at two stages (decision 6). OSM and Google/MapKit stay reference-only (ADR-0010, DATA_POLICY);
   this ADR changes nothing about them.
6. **Community data is visible at multiple verification stages**, only after: App Attest / anti-abuse, moderation
   `accepted`, reviewer queueing, an explicit exact map pin, consent to the current report terms, the source rights
   gate (Issue #124), an explicit known spot type for a single report, and coordinate validation. Raw or unmoderated
   reports are never visible. Promotion `communityReported → communityVerified` needs an independent submitter's
   applied `exists` confirmation, checked while every submitter key involved still exists (migration 0023).
7. **Host or business existence is not smoking evidence.** A convenience store, café, station or facility is a
   `hostType`, never a spot type and never existence evidence. "There is a konbini" creates nothing; "there is an
   ashtray beside this konbini", explicitly reported and moderated, can. Community claims resolve by agreement:
   a field takes a value only when every report that states it agrees; nothing is inferred from the host.
8. **Spot taxonomy is first-class.** The v1 `spotType` vocabulary stays (SQLite cannot widen the populated CHECK,
   and old clients decode it); refinements are separate: `spotSubtype` (`smokingCorner`, `tobaccoShopSmokingSpace`)
   and `hostType`. Mapping of the product vocabulary: dedicated smoking area → `designatedOutdoorArea`; smoking
   room → `publicSmokingRoom` / `facilitySmokingRoom`; outdoor ashtray → `ashtray`; smoking-permitted venue →
   `smokingPermittedVenue`; tobacco-shop space → `spotSubtype: tobaccoShopSmokingSpace`; `unknown` stays valid.
9. **Access restrictions are first-class.** `accessType` (`public`, `customerOnly`, `facilityOnly`, `unknown`) plus
   `accessDetail` (`ticketedUsersOnly`, refining `facilityOnly`). Restricted places are searchable with their
   condition shown. Staff-only / private places are **not** public search results: the report vocabulary has no
   value for them, so they cannot enter.
10. **Confidence is never misrepresented.** The quality gate fails when a spot's label is above or beside its
    evidence (`confidence-never-overstated`), never because a lower tier exists. Ranking uses a small, versioned,
    explainable rule (`nearby-ranking.v2`), not a magic score.

## Freshness without personal timestamps (ADR-0007)

A community report's own dates are personal and minimized after 90 days. The review metadata MannerPath publishes is
the **day a reviewer applied** the evidence (`spots.last_reviewed_on`), exposed at **month** precision only
(`verification.lastReviewedMonth`), because a single report's review day is close to its submission day.
`lastVerifiedAt` keeps its exact meaning (observation date of accepted existence evidence) and stays `null` for
community spots.

## Ranking (`nearby-ranking.v2`)

Results sort by distance × factors, ties by distance then ID:

| Factor | Value |
| --- | --- |
| existence: official / operator | 1.0 |
| existence: communityVerified | 1.1 |
| existence: communityReported / unrecognised | 1.3 |
| freshness: stale | 1.2 |
| access: customerOnly / facilityOnly | 1.1 |

The largest combined factor (≈ 1.72) is under 2×, so no tier outranks a place half its distance away; an
official place 1 km away never beats a community-confirmed one 200 m away.

## Relationship to earlier ADRs

- **ADR-0006** (evidence and publication): the source-registry gate, provenance and publication membership are
  unchanged. Amended: `evidenceQuality` v3 values; the `verification` object; community tiers.
- **ADR-0007** (report privacy): unchanged retention. Amended: structured claims on `missing` reports (categorical
  claims are place facts and survive redaction; free-text host name / hours note are personal content, minimized
  at 90 days and never published); the reviewer apply day as non-personal review metadata, published by month.
- **ADR-0008** (nationwide architecture): the community source stays additive; an observation may carry a
  classification and a community tier (`source_observations.claims_json`).
- **ADR-0011** (derived coordinates): stays **Proposed**. `reviewedDerived` exists in the vocabulary so a future
  approval needs no schema change; nothing emits it for a published spot today.

## Compatibility

Tile and spot-detail bodies stay `schemaVersion: 1`: every addition is an ignorable field or an already tolerated
string (`evidenceQuality`). An older app shows a community spot as "evidence confidence unknown" (its existing
fallback for unrecognised values), never as official. `/v1/config` adds `reports.newSpotClaims` so a client sends the
new report `claim` only to a deployment whose strict schema accepts it.

## Consequences

- When Issue #124's terms are granted and the community source approved, `communityReported` and `communityVerified`
  listings publish, promote (promotion v3, sanitized records only) and count in quality, with no further code.
- Quality reports tier coverage separately (`coverage.official / operator / communityVerified / communityReported /
  allVisible`); official coverage is never inflated by community counts.
- Upgrading a spot's tier is the one write to a canonical spot outside the resolver
  (`community-verification.ts`), limited by trigger to the four evidence-tier columns.

## Amendment 2026-10-02 — approximate area locations (ADR-0016)

Decision 3 gains a fifth precision value, `areaApproximate` (specified, not yet implemented): accepted evidence places
the smoking place inside an area/host whose reviewed anchor is the pin. Missing exact coordinates alone no longer
reject an evidenced spot; host existence is still never evidence.

## Amendment 2026-10-01 — acquisition lifecycle (ADR-0013)

The published tiers are unchanged. ADR-0013 names the lifecycle inside them: `reported` (communityReported) →
`visitedConfirmed` (communityVerified reached through one independent on-site `exists` confirmation, two submitters)
→ `communityVerified` (two submitters at creation, or three or more). Negative findings follow decision 4: a single
`notFound`/`removed` is a recheck signal, never a removal; only a reviewed, corroborated, rights-gated absence hold
(migration 0024) withdraws a community-evidenced or official spot from publication, and stale evidence is never
treated as negative evidence.

