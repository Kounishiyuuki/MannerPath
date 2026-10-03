# Delivery Roadmap

## Phase 0 — Foundation

- lock requirements and ADRs;
- create Xcode iOS + Watch targets;
- establish Swift 6 concurrency settings;
- establish backend Worker/D1 project;
- define first real municipal source and import fixture.

Exit: repository builds on a clean machine and CI can run core tests.

## Phase 1 — Offline-first nearby vertical slice

- Core Location;
- Spot domain model;
- GRDB migration;
- seed fixture data;
- nearby query + hard filters + ranking;
- MapKit pins/list;
- offline distance/bearing.

Exit: usable without backend using fixture/cached data.

## Phase 2 — Real data sync

- shared Swift/TypeScript tile test vectors (ADR-0005);
- launch-region density/payload benchmark → fix `DATA_TILE_ZOOM` (ADR-0005);
- decide concrete evidence/provenance schema (ADR-0006);
- D1 schema;
- tile API + ETag;
- first municipal importer;
- OSM importer (publication gated on ODbL review, see `DATA_POLICY.md`);
- attribution UI;
- source/confidence model.

Exit: real launch-region data flows from source to device.

## Phase 3 — Navigation + constrained search

- spot detail;
- MKDirections walking preview;
- system Apple Maps handoff;
- filters;
- destination search;
- route-detour ranking while online.

## Phase 4 — Apple Watch

- Watch nearby list;
- preference sync;
- snapshot transfer/cache;
- independent local ranking;
- distance/bearing fallback;
- complication/widget entry point.

## Phase 5 — Verification/reports

- report privacy/retention ADR;
- report API;
- App Attest/rate limits;
- moderation/reconciliation workflow;
- last-verified/confidence updates;
- coverage-first multi-confidence model (ADR-0012, Issue #143): community tiers `communityReported` /
  `communityVerified`, structured new-spot claims, confidence axes on tiles, iPhone/Watch labels and filters —
  implemented; publishes nothing user-derived until Issue #124's rights are granted.
- community acquisition engine (ADR-0013): add-a-place entry, one-tap "it was here", structured corrections and
  negative findings, absence review/hold, relocation and duplicate candidates, moderation triage, coverage tasks and
  seed areas, acquisition targets, prefecture and seed-station metrics — implemented; still gated by Issue #124.
  Follow-ups: community evidence photo attachments; venue/operator self-registration source; licensed station
  reference dataset for top-50/top-300 coverage.

## Phase 6 — Nationwide data architecture

- write the nationwide data architecture ADR;
- extract a source-adapter boundary without changing current Taito output;
- add a normalized source-observation layer;
- support cross-release matching, removals and relocations;
- generalize attenuation/conflict handling;
- make promotion and quality analysis multi-source/multi-release;
- preserve byte-for-byte tile/ETag behavior for the existing approved source with golden tests.

Exit: adding a second reviewed source no longer requires a Taito-specific pipeline rewrite.

## Phase 7 — Source discovery and nationwide ingestion

- review official municipal/government/open-data sources and their original terms;
- keep every unreviewed candidate unpublished;
- add reviewed sources through declarative adapters where practical;
- decide OSM/ODbL adoption in a dedicated ADR before any OSM-derived production publication;
- add raw release retention/fingerprinting and repeatable freshness checks;
- add cross-source duplicate/review workflow;
- acquisition order (ADR-0012, `NATIONWIDE_DATA_STRATEGY.md` §3, §12): reusable official/operator data → community
  acquisition → venue/operator direct submissions → reference-only discovery → confidence upgrading.
- nationwide community seed campaign (#149): 249 geographic collection areas across 47/47 prefectures, 52/52 #145
  official-information groups reflected; deterministic `npm run community:seed` JSON/Markdown campaign, P0–P3,
  station/airport/downtown gap metrics and the existing ADR-0013 coverage-task connection. This is an implemented
  collection channel, not 249 new spots. Execution/publication still needs #124; the first 1,000-spot rollout is in
  `services/data-pipeline/research/community-acquisition/README.md`.

Rollout stages:

- N1: Tokyo 23 wards + Osaka;
- N2: ordinance-designated cities + prefectural capitals;
- N3: nationwide coverage targets (continuous; not a release blocker).

v1 release gate (PRODUCT_REQUIREMENTS §10, NATIONWIDE_DATA_STRATEGY §6): nationwide behavior, honest empty/coverage
states and evidence integrity. Coverage (spot count, prefectures, major cities and stations, population-weighted) is
measured continuously and keeps improving after release.

## Phase 8 — Nationwide quality gate and coverage measurement

- calculate station-area and population-weighted coverage, reported as official-source coverage and all usable
  coverage, with each community tier separate;
- measure nearest-spot distance distributions;
- require an explicit evidence class for every published spot, and zero overstated labels;
- require zero unresolved publication conflicts and zero unreviewed published sources;
- enforce freshness reporting and per-source unknown-rate reporting;
- validate tile density/payload thresholds at nationwide scale.

Exit: the v1 release gate in `NATIONWIDE_DATA_STRATEGY.md` §6 passes (integrity and nationwide behavior). The coverage
targets in the same section are measured and reported; they continue after release and do not block it.

## Phase 9 — Final product and UI completion

- complete all iPhone, Watch and widget product flows against nationwide/multi-source data;
- re-audit current Apple HIG and SDK behavior;
- prefer system navigation/control components and system Liquid Glass;
- add custom glass only where a standard component is insufficient;
- finish light/dark, Dynamic Type, VoiceOver, Reduce Motion/Transparency and Japanese layout checks;
- finish empty/offline/stale/coverage/unknown states;
- remove remaining debug/development wording.

Exit: the product is functionally and visually complete without relying on paid signing.

## Phase 10 — Final signing and physical-device gate

Only after Phases 6–9:

- join/use an Apple Developer Program paid team;
- provision all four Apple targets with the required App Group;
- provision App Attest for the iPhone app;
- build and inspect a signed archive;
- run physical iPhone/Watch/widget E2E;
- run real App Attest register/assert/report flows;
- close any device-only defects.

Capabilities are never removed to work around Personal Team limitations.

## Phase 11 — TestFlight and App Store release

- privacy manifest/labels final review;
- App Review notes;
- TestFlight distribution and final data-quality validation;
- legal attribution review;
- crash/diagnostics policy;
- production monitoring and rollout;
- listing/screenshots/marketing only after the product gate is satisfied.
