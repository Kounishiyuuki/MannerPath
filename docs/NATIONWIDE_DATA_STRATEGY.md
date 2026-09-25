# Nationwide Data Strategy — MannerPath

Status: **Planning baseline for product completion**

This document turns the nationwide-data research into repository policy and implementation sequencing. It does **not** approve any new external source. Candidate-source facts must be verified against the publisher's original terms before they can enter `docs/SOURCES.md` as approved.

## 1. Goal

MannerPath is product-complete only when discovery is practically useful across Japan, not merely inside the original Taito development geography.

"Nationwide" does not mean inventing a result at every coordinate. It means:

- the app and backend work anywhere in Japan;
- approved nearby smoking places are discoverable where evidence exists;
- broad national coverage passes the quantitative release gate below;
- places without approved evidence remain absent/unknown;
- the UI distinguishes no nearby approved data from network/cache failures.

The existing rules remain non-negotiable: a convenience store or other host does not prove an ashtray or smoking permission; unknown is not false; every published spot needs approved existence evidence.

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

Priority:

1. reviewed municipal/government open data and official public facility lists;
2. reviewed official/operator data with compatible reuse permission;
3. OSM only if a dedicated ODbL ADR approves a safe production architecture;
4. reviewed community/user evidence through moderation.

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
| Freshness | At least 90% of published spots have `lastVerifiedAt` within 365 days; reviewed-source fetch checks within 30 days |
| Existence evidence | 100% of published spots, no exceptions |
| Publication conflicts | 0 unresolved conflicts capable of producing a false actionable claim |
| Source review | 0 unreviewed sources in published data |
| Unknown fields | Reported transparently by source/region; unknown is not converted to false |

Population/station reference datasets used only to measure coverage still require their own license review.

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

- closure/move/restriction reports can lead to attenuation or hold after abuse controls and review;
- a new community spot requires corroboration across independent evidence plus moderation;
- host/business existence is never sufficient evidence;
- only reviewed community-derived records may count toward the nationwide release gate.

## 9. UI implications of nationwide data

The product UI must handle:

- multiple attributions and evidence levels without overwhelming the primary navigation task;
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
