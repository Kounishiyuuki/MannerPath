# MannerPath Specification — cross-cutting invariants and document map

Status: **Baseline 2026-10-02.** This is the entry point to MannerPath's specification. It states the invariants that
every change must preserve and names the canonical document for each detail. It deliberately does **not** repeat
numbers, schemas or procedures; follow the links. When this file and a linked canonical document disagree, the
canonical document wins for its detail and the conflict is a documentation bug to fix in the same change.

GitHub issues are not specification. A decision made in an issue binds only once it is recorded in a document below.

## Canonical document map

| Concern | Canonical document |
| --- | --- |
| Cross-cutting invariants, document ownership (this file) | `docs/SPECIFICATION.md` |
| User/product behavior, UI requirements, release sequencing | `docs/PRODUCT_REQUIREMENTS.md` |
| Source, evidence, confidence, license and publication rules; source onboarding | `docs/DATA_POLICY.md` |
| Nationwide acquisition, coverage measurement, release gate | `docs/NATIONWIDE_DATA_STRATEGY.md` |
| System architecture and layers | `docs/ARCHITECTURE.md` |
| Wire contracts (tiles, spots, reports, config) | `docs/API.md` |
| Runtime, deployment, promotion, moderation, backup operations | `docs/OPERATIONS.md`, `docs/SEGMENTED_PROMOTION_RUNBOOK.md`, `docs/COMMUNITY_SCALE_RUNBOOK.md`, `docs/COMMUNITY_LAUNCH_CHECKLIST.md` |
| Individual reviewed sources | `docs/SOURCES.md` |
| Data-quality evidence for the beta corpus | `docs/BETA_DATA_QUALITY.md` |
| Chosen technologies | `docs/TECH_STACK.md` |
| Sequencing and status | `docs/ROADMAP.md` |
| Why/when architectural decisions were made | `docs/adr/*` |
| Agent rules and validation workflow | `AGENTS.md`, `apps/apple/AGENTS.md`, `services/AGENTS.md`, `docs/AGENT_WORKFLOWS.md` |
| Research records (positive and negative) | `docs/research/**` |

Category coverage (audit 2026-10-02): privacy policy → ADR-0007 + PRODUCT_REQUIREMENTS §8 (photos: ADR-0016); security/abuse model →
ADR-0007 §6 (App Attest, abuse keys) + ADR-0014 + OPERATIONS; moderation → ADR-0013 + ADR-0016 (photo review) + OPERATIONS "Community
publication"; source onboarding → DATA_POLICY "Nationwide source onboarding" + SOURCES; evidence/confidence model →
ADR-0006 + ADR-0012 + DATA_POLICY "Confidence"; coordinate/location model → ADR-0011 + **ADR-0017**; offline →
ADR-0004 + PRODUCT_REQUIREMENTS §7; release/deployment → PRODUCT_REQUIREMENTS §12 + OPERATIONS; testing/quality gates
→ AGENTS.md + AGENT_WORKFLOWS + BETA_DATA_QUALITY; contributor/AI workflow → AGENTS.md + AGENT_WORKFLOWS.

## 1. Product purpose

MannerPath is a **navigation/compliance utility for quickly finding places in Japan where smoking is permitted.** It
is not a tobacco purchase, brand-promotion or consumption-encouraging product (no sales, purchase links, brands,
streaks, rewards or gamification).

In scope: designated smoking areas; smoking rooms; outdoor smoking points/ashtrays where permission is evidenced;
station, airport and commercial-facility smoking spaces; tobacco-shop smoking spaces; convenience-store side ashtrays
when independently evidenced; cafés/restaurants where smoking is explicitly permitted; customer-only and
facility-only areas (shown with their condition). Taxonomy: PRODUCT_REQUIREMENTS §3, ADR-0012 decision 8.

**Nationwide coverage is a product-completion requirement** (PRODUCT_REQUIREMENTS §10).

## 2. Coverage-first principle

Find as many real permitted places as possible **and** state how far each can be trusted (ADR-0012).

- Low confidence ≠ hidden. False confidence is forbidden.
- Official data alone cannot reach nationwide coverage and is not the only publishable route.
- Official, operator and community evidence are separate tiers, counted separately, never summed into "official".

## 3. Existence and location are independent axes

How sure we are that a smoking place **exists** and how exact its **pin** is are different questions.

- Existence evidence (`verification.existence`): `official`, `operator`, `communityVerified`, `communityReported`.
- Location precision (`verification.locationPrecision`), implemented today: `publisherPoint`, `reviewedDerived`
  (ADR-0011; not yet emitted for published spots), `communityPinned`, `unknown`.
- **Specified, not yet implemented (ADR-0017, maintainer decision 2026-10-02): `areaApproximate`** — accepted evidence
  says the smoking place is inside a specific park, station, facility, airport or commercial building, but the point
  of the smoking place itself is unknown. A reviewed, reusable representative anchor of that area/host may be used as
  a provisional pin.

A spot with accepted smoking-place existence evidence is **not rejected only because an exact smoking-point
coordinate is missing**. Example: a municipality states "there is a smoking area in ○○ Park", the area's own point is
unknown, and a reviewed representative coordinate of the park exists → `existence = official`,
`locationPrecision = areaApproximate`, a publishable candidate. The inverse is never allowed: the park existing does
not mean a smoking place exists.

## 4. Approximate location presentation

An `areaApproximate` pin is never presented as an exact point (ADR-0017, PRODUCT_REQUIREMENTS §3):

- list: 「位置は○○内の目安です」
- detail: 「喫煙場所はこの施設/公園内にあることが確認されています。正確な位置は未確認のため、ピンは目安です。」
- navigation: exact → 「この場所へ案内」; approximate → 「この付近へ案内」
- distance may read 「約○m」.
- VoiceOver, widgets and Watch state the approximation too.

When an exact location arrives later, the **stable spot ID is kept** and the precision upgrades
(`areaApproximate` → `publisherPoint` / `communityPinned` / `reviewedDerived`).

## 5. Evidence invariants

- convenience store existence ≠ ashtray existence
- ashtray existence ≠ permission to smoke
- host POI ≠ smoking spot
- restaurant/café existence ≠ smoking-permitted venue
- park/station/facility existence ≠ smoking-place existence

But accepted smoking-place existence evidence **plus** a reviewed approximate host/area anchor can be publishable
(§3). Canonical: ADR-0006, ADR-0012 decision 7, DATA_POLICY.

## 6. Unknown semantics

**unknown ≠ false**, for opening hours, `openNow`, tobacco support, access, environment, location precision and
source completeness. Unknown is never converted to "no" (or to "yes"). `openNow` is never inferred without known hours.

## 7. Source and evidence hierarchy

Priority (DATA_POLICY "Source priority") orders evidence; it is not a publication filter and lower priority is never
by itself a reason to hide a spot:

1. official reusable, 2. operator, 3. community verified/reported, 4. reference-only discovery.

Google Maps, Apple Maps, OSM, blogs, other apps and social posts may be used as **discovery leads/references** even
where their terms forbid canonical reuse. Their coordinates, text or other values are never copied into the canonical
database without a reviewed reuse basis. **Discovery ≠ provenance**: a lead tells us where to look; only accepted
evidence from an approved source or workflow is provenance.

## 8. Official data is not mandatory

Nationwide coverage combines community (reported/verified), operator submissions and official sources. Official
evidence found later upgrades confidence of an existing spot (same ID); it is not a precondition for listing.
Strategy: NATIONWIDE_DATA_STRATEGY §1, §12.

## 9. Community evidence

Canonical: ADR-0012, ADR-0013, ADR-0007, OPERATIONS "Community publication".

- `communityReported`: one moderated, consented, explicitly classified report. `communityVerified`: independent
  corroboration. Raw or unmoderated reports are never visible.
- **Production community publication is blocked until Issue #124 / the legal rights decision is granted.** The
  technical foundation existing is not a grant.
- Photos (ADR-0016, technical foundation merged in PR #162, default OFF; production intake and publication not approved): a private
  attachment to an existing report and an advisory signal for review only. It never accepts a report, counts as an
  independent submitter, upgrades existence confidence, supplies coordinates or bypasses reconciliation. A photo of an
  ashtray alone does not establish that smoking is permitted. Photos are never in tiles and have no public retrieval.

## 10. Coordinates and provenance

Every published coordinate states its origin: publisher point, community pin, reviewed derived (ADR-0011) or
approximate area/host anchor (ADR-0017). Approximate anchors need their own provenance and reuse review.

Forbidden: arbitrary or manually guessed exact pins; coordinates guessed from map screenshots; a polygon centroid or
host centre presented as the exact smoking location or labelled `publisherPoint`; copying Google/Apple POI points as
persistent canonical coordinates; using OSM values in production without ADR-0010 approval. Using a reviewed
representative anchor **as `areaApproximate`** is permitted.

## 11. OpenStreetMap

ADR-0010 is canonical: OSM is **reference-only**; no OSM value is stored, published or used to attenuate a claim.
Any future adoption follows ADR-0010 and legal review.

## 12. MapKit / Apple Maps

Presentation, routing and destination search only (ADR-0001, DATA_POLICY). Not the canonical smoking-place database;
Apple POIs are never bulk-harvested.

## 13. Publication

- Publication requires accepted existence evidence (ADR-0006).
- Conflicting evidence never raises confidence; the claim becomes unknown or held. Never cherry-pick the favourable
  side of a conflict (DATA_POLICY "Contradicting official publications", ADR-0008).
- stale ≠ removed; one negative community report ≠ removal (ADR-0012 decision 4, ADR-0013).

## 14. Spot identity

Spot IDs are stable. Source changes, confidence upgrades, precision upgrades and relocation reviews do not create new
IDs unnecessarily; merges/redirects and relocation follow ADR-0006, ADR-0008 and ADR-0009.

## 15. Freshness

`lastVerifiedAt` is the evidence observation time, never fetch/import time (ADR-0006). Community spots never expose a
personal report timestamp; they use `lastReviewedMonth` (ADR-0012). Stale is a label and ranking factor, not a
removal reason.

## 16. Privacy

No raw location history; no account for browse/search; routine sync by tile ID (PRODUCT_REQUIREMENTS §8). Community
reports follow ADR-0007 minimization and retention, free text and personal metadata included. Photos (ADR-0016)
persist only a freshly encoded derivative without EXIF/GPS/device/capture metadata, stay private, never outlive the
parent report's `minimize_after`, and live in `REPORTS_DB`/private object storage, never in canonical `DB`, promotion
bundles or tiles. Metadata removal does not remove visible faces or plates; moderators reject such images.

## 17. Offline

Offline spot discovery is guaranteed; full offline routing is not a v1 requirement (ADR-0004, PRODUCT_REQUIREMENTS
§7). The client cache must stay consistent with the tile schema and data zoom it was built for (ADR-0015).

## 18. Tile and data architecture

Current main, details in ADR-0005, ADR-0015, ARCHITECTURE and API: Cloudflare Workers + D1; per-tile complete
snapshots replaced atomically on the client; bounded manifest + parts; `dataTileZoom` from `/v1/config`;
content-addressed hashes and ETags; segmented promotion v4 with GREEN bootstrap; fail-closed integrity checks
throughout (SEGMENTED_PROMOTION_RUNBOOK).

## 19. Promotion and production safety

Promotion artifacts are deterministic. A partial or incomplete GREEN database is never ready. Remote D1 writes,
deploys and cutovers are explicit production operations (OPERATIONS); a development task never performs them on its
own initiative.

## 20. Apple platform

iPhone: map, list, detail, search, filter, navigation, report, offline. Watch: nearby, offline snapshot, bearing,
navigation hand-off. Widgets/App Intents: as in PRODUCT_REQUIREMENTS. UI: SwiftUI/system components first; Liquid
Glass never at the cost of readability; VoiceOver, Dynamic Type, Reduce Motion, Reduce Transparency
(PRODUCT_REQUIREMENTS §4, §5, §11; `apps/apple/AGENTS.md`).

## 21. Release order

nationwide data → functional completion → UI/accessibility → paid Apple Developer Program → capabilities/signing →
physical-device E2E → TestFlight/App Store (PRODUCT_REQUIREMENTS §12, ROADMAP). Personal Team limits never justify
removing a security or product capability.

## 22. Nationwide completion

Practical coverage in all 47 prefectures, measured per tier by NATIONWIDE_DATA_STRATEGY's gate. Do not confuse
official-only coverage with all-visible coverage. Seed coverage ≠ spot coverage; source count ≠ product coverage;
"N municipal sources collected" is not completion.

## 23. Research rules

Keep negative results. Record important bounded scans durably (research Markdown + machine-readable JSON under
`docs/research/`, and the issue comment that references them) so the same search is not repeated. "Not found" ≠
"does not exist".

## 24. AI development contract

`AGENTS.md` carries the short form of these invariants. Agents read this file when product or data behavior changes,
and never weaken source, privacy, licensing or confidence rules silently: a change to a rule updates its canonical
document (and ADR) in the same change.

## 25. Implementation follow-ups (not done by the documentation baseline)

- [ ] `areaApproximate`: add to `locationPrecision` in D1 CHECKs, tile/spot DTOs, API schemas and contract docs
      (ADR-0017 §Implementation).
- [ ] Approximate anchor registry with provenance and reuse review; reviewed-anchor workflow; quality check that no
      anchor is labelled `publisherPoint`.
- [ ] Resolver/publication: allow accepted existence evidence + reviewed anchor; keep host-only records rejected.
- [ ] iPhone/Watch/widget copy for approximate list/detail/navigation/distance and VoiceOver (§4).
- [ ] Precision upgrade path keeping the stable spot ID.
- [ ] Re-run the coverage replay (NATIONWIDE §12) to count research targets newly eligible under ADR-0017.
- [x] Photo evidence ADR: ADR-0016 (technical foundation, disabled by default).
- [ ] Photo intake prerequisites (ADR-0016): reviewed photo-consent terms version, fenced private storage adapter
      with expiry, deletion scheduler/alerting, Workers CPU/memory and adversarial-corpus testing; #124 for any
      publication.
