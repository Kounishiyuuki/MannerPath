# Nationwide Data Strategy — MannerPath

Status: **Planning baseline for product completion**

This document turns the nationwide-data research into repository policy and implementation sequencing. It does **not** approve any new external source. Candidate-source facts must be verified against the publisher's original terms before they can enter `docs/SOURCES.md` as approved.

## 1. Goal

MannerPath is product-complete only when discovery is practically useful across Japan, not merely inside the original Taito development geography.

"Nationwide" does not mean inventing a result at every coordinate. It means:

- the app and backend work anywhere in Japan;
- as many permitted smoking places as possible are discoverable, **each labelled with how far it can be trusted**
  (ADR-0012 coverage-first multi-confidence model);
- broad national coverage passes the quantitative release gate below, measured per evidence tier;
- places without any accepted evidence remain absent/unknown;
- the UI distinguishes no nearby data from network/cache failures.

**Nationwide coverage is not achievable from official datasets alone.** Official open data rarely lists
convenience-store side ashtrays, small smoking corners, cafés and kissaten where smoking is permitted, or
customer-only spaces, and 33 of 61 reviewed research targets are blocked only because the official data does not
carry the smoking place at all (§12). Coverage therefore comes from several evidence routes, each counted
separately and never summed into "official".

The existing rules remain non-negotiable: a convenience store or other host does not prove an ashtray or smoking permission; unknown is not false; every published spot needs accepted existence evidence of an explicit class.

## 2. Architecture direction

The current source/release/provenance/publication/tile foundation is retained. Nationwide work generalizes the pipeline around it instead of replacing it.

Target flow:

```text
fetch per reviewed source
  -> immutable raw release + fingerprint
  -> versioned source adapter (parse + schema mapping)
  -> normalized source observations
  -> cross-release entity matching
  -> cross-source clustering/review
  -> evidence-aware canonical resolver
  -> provenance / attenuation / publication holds
  -> regional + nationwide quality gates
  -> changed-tile publication
  -> multi-release promotion manifest
```

Required architectural work:

- extract a generic source-adapter boundary, with Taito as the first adapter;
- add normalized, immutable source observations so the resolver does not depend on raw source schemas;
- support repeated releases from one source, including closure/removal and relocation handling;
- generalize conservative conflict attenuation beyond Taito-specific constants;
- support multiple reviewed sources/releases in promotion and quality analysis;
- support cross-source duplicate candidates and an explicit review queue;
- retain stable canonical IDs and redirects when spots merge;
- retain content-addressed tile/ETag behavior and reevaluate tile sizing only when ADR thresholds require it.

## 3. Source strategy

Priority (ADR-0012):

1. **reusable official/operator data** — reviewed municipal/government open data, official facility lists and operator
   data with compatible reuse permission (`official` / `operator`);
2. **community acquisition** — moderated, consented, explicitly classified reports (`communityReported`), corroborated
   by independent submitters (`communityVerified`); needs Issue #124 before anything publishes;
3. **venue/operator direct submissions** (future) — a shop or facility stating its own smoking space, reviewed as an
   operator source; not built yet;
4. **reference-only discovery** — license-unresolved official pages, OSM (ADR-0010), Google/MapKit and other apps:
   leads for where to look and conflict references, never a source of published values;
5. **confidence upgrading / re-verification** — independent confirmations, official evidence found later (cross-source
   review), and re-checks that keep freshness honest.

Web pages, PDFs, maps or catalogs with unclear reuse terms may be used only as conflict/reference material that weakens a claim, not as a source of published values, unless their applicable reuse terms are reviewed.

Search-result snippets and catalog metadata are discovery aids only. They do not approve a license.

## 4. OSM decision gate

OSM remains blocked for production publication until a dedicated ADR decides:

- attribution surfaces across iPhone, Watch, widgets and API;
- whether MannerPath's combined canonical database would create share-alike obligations;
- whether OSM-derived records must remain separated from official-source records;
- what redistribution/export obligations apply to database/API/tile outputs;
- how official evidence and OSM evidence interact without silently overwriting each other.

The nationwide goal alone does not authorize using OSM.

Decided by ADR-0010 (Issue #110): legal review required before adoption; reference-only in the meantime; canonical integration rejected; isolated OSM-derived database is the only adoptable architecture. The §6 gate is planned without OSM.

## 5. Rollout stages

### N1 — dense initial multi-source proof

Target: Tokyo 23 wards and Osaka.

Purpose: prove that the pipeline supports more than one municipality/source, repeated releases and dense urban tiles.

### N2 — major-city coverage

Target: all ordinance-designated cities and prefectural capitals, prioritizing high-traffic station areas.

### N3 — nationwide release gate

Target: quantitative nationwide coverage and quality thresholds below.

## 6. Nationwide release gate

These are product release targets and may be tightened as measurements improve:

| Metric | Gate |
| --- | --- |
| Major stations | At least 95% of the top 50 and 80% of the top 300 passenger-volume stations have a published spot within 500 m |
| Nearest-spot distribution around top 300 stations | Median <= 300 m; p90 <= 800 m |
| Population-weighted coverage | At least 85% of densely inhabited areas and 60% nationwide population coverage have a published spot within 1 km |
| Regional representation | 47/47 prefectures represented; every prefectural-capital central station has at least one published spot within 1 km |
| Major municipality representation | All ordinance-designated cities and Tokyo 23 wards have reviewed source coverage |
| Freshness | Reported per tier (`freshness.v1`: fresh / aging / stale / unknown); at least 90% of **official** spots fresh; reviewed-source fetch checks within 30 days. Staleness labels a spot, it never removes it |
| Existence evidence | 100% of published spots carry an explicit evidence class (`verification.existence`), no exceptions |
| Confidence integrity | 0 spots labelled above their evidence (`confidence-never-overstated`) |
| Publication conflicts | 0 unresolved conflicts capable of producing a false actionable claim |
| Source review | 0 unreviewed sources in published data |
| Unknown fields | Reported transparently by source/region; unknown is not converted to false |

Population/station reference datasets used only to measure coverage still require their own license review.

Every coverage metric above is reported twice — **official-source coverage** (`official` + `operator`) and **all
usable coverage** (`allVisible`, every tier) — with `communityVerified` and `communityReported` shown separately
(`quality.nationwide.coverage`). The gate states which of the two it is met on; neither number may be presented as
the other.

## 7. Source-update behavior

- unchanged remote bytes update fetch/check metadata but do not advance `lastVerifiedAt`;
- changed bytes create a new immutable release;
- schema/header changes stop automatic application;
- large record-count drops or large coordinate movements require review;
- disappearance is removal evidence only for sources reviewed as complete for the relevant scope;
- partial sources never imply removal merely because a record disappears;
- cross-source conflicts resolve conservatively to unknown/hold unless an explicit reviewed evidence rule applies.

## 8. User reports

Reports remain evidence proposals, not direct canonical edits.

- closure/move/restriction reports can lead to attenuation or hold after abuse controls and review; one negative
  report never deletes a spot;
- a new community spot is `communityReported` on one moderated, consented report with an exact pin and an explicit
  known spot type, and `communityVerified` with independent corroboration (ADR-0012);
- host/business existence is never sufficient evidence;
- only reviewed community-derived records may count toward the nationwide release gate, in their own tier.

Implemented for new spots by Issue #123 (ADR-0007 and ADR-0006 community amendments). Originally a reviewer applied an explicit application of at least two accepted, queued reports from distinct submitters at one report's pin, entering the ordinary resolver as a `userReport` source with evidence quality `communityReviewed`; ADR-0012 below adds the single-report tier. Such spots count toward the §6 gate only once they are published. They are not published today: the community source is blocked until user-submission reuse rights exist (Issue #124). Existing-spot reports are connected to reviewed effects and, for `prohibited`, a corroborated publication hold (Issue #127).

ADR-0012 (Issue #143) adds the single-report tier `communityReported`, the independent-confirmation upgrade to
`communityVerified`, and structured claims (spot type, subtype, access, host type, environment, tobacco) on
new-spot reports. New applications write `communityVerified` (v3) instead of `communityReviewed` (v2).

## 9. UI implications of nationwide data

The product UI must handle:

- multiple attributions and evidence levels without overwhelming the primary navigation task — one short evidence
  label per place (公式確認済み / 利用者確認済み / 利用者報告・未確認), a distinct but calm map pin per tier;
- regions with sparse or no approved data;
- stale versus unavailable data;
- unknown access/type/hours without false precision;
- coverage limitations as data-quality information, not as a generic network error.

The final Apple-platform UI pass should use standard SwiftUI/navigation/control components and system Liquid Glass behavior wherever possible. Nationwide data correctness and readability take priority over decorative effects.

## 10. Release ordering

1. nationwide architecture ADR;
2. behavior-preserving adapter extraction with golden output tests;
3. normalized observation layer;
4. cross-release matching/removal/relocation;
5. raw-release retention/fingerprinting and scheduled checks;
6. second reviewed source and multi-source promotion;
7. cross-source review/merge workflow;
8. nationwide quality metrics;
9. N1 -> N2 -> N3 source rollout;
10. final functionality/UI/accessibility completion;
11. paid Apple Developer Program signing, App Groups/App Attest, physical-device E2E;
12. TestFlight/App Store release.

The Apple Developer Program is intentionally the final release dependency. Product capabilities must not be removed to make a Personal Team build succeed.

## 11. Research status

The current research identified official-data candidates in multiple municipalities and OSM as the main possible broad-coverage source, but most candidate license/update/schema details were not verified from original pages during that research session. They remain candidates only.

The next source-research pass must record, per candidate:

- publisher/owner;
- original license/terms URL;
- attribution text;
- geographic scope and completeness;
- update date/frequency;
- coordinates and available fields;
- automated-fetch stability;
- explicit approval/rejection decision.

Approved sources continue to live in `docs/SOURCES.md`; this strategy document does not substitute for source review.

## 12. Coverage acquisition strategy (ADR-0012)

Replay of every committed research verdict under the new model (`npm run replay:coverage`, output
`docs/research/nationwide-discovery/2026-10-01-coverage-replay.json`; rules in
`services/api/src/quality/coverage-replay.ts`). 61 review records (some jurisdictions appear both as a dataset
review and a target review):

| Why it was 0 | Records | Route |
| --- | --- | --- |
| Data does not carry the smoking place (host point only, no smoking category/point, no coordinate) | 33 | C — community acquisition target (records with accepted existence evidence and only a missing point: re-check under ADR-0017) |
| Both rights and data blockers | 25 | D — reference lead only |
| Rights only (license/reuse) — data itself usable | 1 (中央区, 79 supplied smoking points) | D until reuse permission; then A |
| Already a reviewed, published source (duplicate research) | 2 | A |

ADR-0012 relaxes exactly one blocker: `currentOperationUnknown` alone no longer withholds a dated official listing
(it publishes with its date and a freshness label); explicit closure evidence still blocks. No other research
verdict changes: coverage-first never turns a host facility or an unlicensed file into a spot.

ADR-0017 (2026-10-02, implemented by migration 0030) changes how a **missing coordinate** is read: it is no longer by
itself a permanent blocker. Where accepted smoking-place existence evidence places the spot inside a park, station or
facility and a reviewed reusable anchor of that area exists, the record is an `areaApproximate` candidate. A record
whose only content is a host point, with no statement that a smoking place exists there, stays blocked. The replay above
predates ADR-0017; its ADR-0017 replay is `docs/research/2026-10-02-approximate-location-replay.md`: of 202 replayed
targets, ADR-0017 removes the location blocker for 21 (39 places stated), but every one is still blocked first by
unreviewed reuse rights, so none is publishable today. Even with rights granted none reaches A: 仙台市 (one park,
same-source anchor) and 22 others stop at E (closure evidence, or current operation the review left unresolved —
unknown is not "operating"), 11 need an anchor (policy v2) and 5 address-only ones need ADR-0011.

Ordering from here:

1. **Rights for reusable official/operator data.** Ask the publishers whose data is otherwise usable (中央区 first;
   then the address-only sources whose only other gap is ADR-0011) for explicit reuse permission.
2. **Community acquisition** where official data structurally cannot help: stations, konbini side ashtrays, cafés,
   tobacco shops, airports and facilities (the 33 data-only targets and the operator inventories of the
   east/north operator batch). Needs Issue #124 before anything publishes; the pipeline is ready.
3. **Venue/operator direct submissions** — a later operator-source route for shops and facilities.
4. **Reference-only discovery** keeps pointing reviewers and reporters at likely places; it never publishes.
5. **Confidence upgrading** — independent confirmations, cross-source review against official data, re-checks.

## 13. Community acquisition engine — the nationwide collection channel (ADR-0013)

Official open data stays the preferred evidence, but it cannot carry the places most smokers actually use: konbini side
ashtrays, café and restaurant smoking, tobacco-shop spaces, small corners at stations and facilities. Community
contribution is therefore a **first-class acquisition channel**, built so that collection can begin the day Issue #124's
rights are granted:

- **Contribute:** "Add a smoking place" (toolbar and empty state) → map pin → what is there (the one required answer) →
  optional access/host/details → terms → submit. "Is it one of these?" shows listed places within 50 m first.
- **Confirm:** "It was here" on every place (two taps once the terms are agreed); "Something is different" for
  not found / removed / moved / type / access / hours / tobacco / prohibited / other.
- **Promote and correct by evidence, not votes:** reported → visitedConfirmed → communityVerified; negatives →
  needsRecheck → reviewCandidate → reviewed, rights-gated hold; agreeing independent pins → relocation candidate.
- **Ask for what matters:** coverage tasks (`coverage-tasks.v1`) — spot tasks derived on the device, coverage gaps
  from seed areas (`GET /v1/coverage/tasks`), shown lightly in Nearby, never pushed.
- **Aim the first campaigns:** `npm run coverage:targets` turns the 33 route-C research targets into a plan linked to
  seed areas (`docs/research/community-acquisition/2026-10-01-targets.json`: 24 linked, 9 needing a seed area).
- **Measure honestly:** `nationwide.communityAcquisition` in the quality report — tiers apart, 47 prefectures, seed
  stations official-only vs all-visible. The user-facing KPI is all-visible coverage (target: 47/47 prefectures with
  usable spots); official coverage is reported beside it and never inflated.
- **Later:** venue/operator self-registration as its own operator source; photo evidence as its own issue.

## 14. Nationwide community seed campaign (#149)

The next nationwide channel is community collection, using #145's research as **area-selection evidence**, rather
than repeating increasingly fine source-approval searches. `services/data-pipeline/research/community-acquisition/`
contains the coordinate-free manifest, aggregate coverage snapshot, deterministic campaign JSON/Markdown and first
1,000-spot rollout plan. `services/api: npm run community:seed` joins current published-coverage counts, major-station
area metrics, review verdicts and the manifest. Optional station metrics must share the coverage snapshot date/revision.

The initial campaign has **249 seeds / 47 prefectures**, including 140 stations, 46 airports, 56 downtown areas,
5 official-lead districts and 2 other coverage gaps. All **52 official-information groups** are reflected (98 seeds
across categories); JR East's incomplete and JR Central's pending research remain weaker investigation context.
Seed names identify independently authored public geographic units, not copied smoking-place inventories. Airport
requests explicitly separate existence, exact location and public/ticketed/facility access. Contributors investigate
station rooms, public areas, facilities, independently confirmed konbini ashtrays, tobacco-shop spaces, cafés,
smoking-permitted restaurants and small outdoor places; a host never proves permission.

Priority follows a reviewable decision table: 0–2 visible spots in national/metropolitan/large-transfer/Shinkansen
hubs → P0; capital station/downtown, airport or explicit official lead → P1; other sparse regions → P2; 3+ visible →
P3; 5+ visible with 3+ official/verified → sufficientlyCovered. Missing counts mean unknown; no population/passenger
figures or AI score is invented. Full reasons and thresholds live in the campaign README and generated report.

The fixed repository baseline has **232 zero-coverage areas**, 132 uncovered major stations, P0/P1/P2/P3 =
67/134/35/13; 44 prefectures still have zero published spots. This is measured from six pinned reviewed-source
fixtures in a fresh local migrated corpus, **not live production telemetry**. The published baseline remains 513
official / 0 community spots in three prefectures; 47/47 **seed representation never counts as spot coverage**.

PR #148's engine is reused: all campaign units extend the existing seed universe and zero-visible units generate
`coverageGap` tasks; the campaign adapter maps P0→1, P1→2, P2/P3→3 to the existing wire vocabulary. Evidence requests
remain campaign instructions until contributors supply observed exact pins; ordinary spot confirmation/location/type/
access tasks then apply. No new UI/API, canonical seed-import path, source approval or rights waiver is introduced.
The geographic-centre list uses hand-authored two-decimal approximate public geography, never official smoking pins,
OSM feature values or third-party map/app values. Area circles overlap and are not a licensed station-volume metric.

Execution plan: pilot 100 unique accepted spots in five zero-coverage P0 markets, expand by 600 in the remaining
top-20 areas, add a distinct 235 across all 47 prefectures, then 65 via airport/access sweeps or replacement P1 gaps.
Track deduplicated community-origin published spots and independent confirmations separately; review individually,
refresh aggregate coverage weekly, and rotate sufficiently covered areas toward current gaps. Issue #124's terms /
rights approval remains required before community publication; until then published community coverage stays zero.

## Nationwide community scale operations

See [Community scale runbook](COMMUNITY_SCALE_RUNBOOK.md) for deterministic local scale profiles,
capacity review after the first 1,000, bounded moderation/retention and D1 measurement limitations.
Simulation does not approve community publication: #124, terms and source rights remain pending.
