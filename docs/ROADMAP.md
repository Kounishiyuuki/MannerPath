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
- last-verified/confidence updates.

## Phase 6 — App Store readiness

- privacy manifest/labels;
- age/eligibility flow;
- App Review notes;
- accessibility pass;
- crash/analytics policy;
- TestFlight data-quality validation;
- legal attribution screens;
- production monitoring.
