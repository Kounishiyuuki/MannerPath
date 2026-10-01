# Nationwide Community Seed Campaign (#149, parent #67)

This is the nationwide **collection channel**, not a smoking-place dataset. The campaign aims for practical discovery:
public areas/ashtrays, station and airport rooms, facility spaces, independently observed convenience-store side
ashtrays, tobacco-shop spaces, cafés, explicitly smoking-permitted restaurants and small outdoor spaces.
A host, a seed or an official research reference is never existence evidence. Contributors supply an independently
observed exact smoking pin and explicit permission/existence; ordinary consent, moderation, provenance and publication
rules apply. No source is approved here. Issue #124 remains a prerequisite for rights-gated public community listings.

## Inputs and reproducibility

- `seeds.json`: curated, coordinate-free geographic units. 249 seeds, 47/47 prefectures; 140 major stations,
  46 airports, 56 downtown districts, 5 official-lead districts and 2 coverage-gap university districts.
  The 5 `officialLead` units are geographic districts, not copied smoking places. Across categories, 98 seeds carry
  explicit official-information lead evidence; all **52/52** #145 groups are linked.
- `current-coverage.json`: counts only, measured from a fresh local SQLite/D1-compatible database, all real migrations,
  six pinned reviewed first-release fixtures and published tiles. It is a **repository baseline, not production telemetry**.
  Snapshot date is fixed at 2026-10-01T00:00:00Z; corpus SHA-256 fingerprints the sorted source IDs and fixture bytes.
  No live database, third-party service or external/reference coordinates are read during campaign generation.
- `docs/research/nationwide-discovery/2026-10-01-official-reverse-reviews.json`: #145 review verdicts. Only target ID,
  explicit-information boolean, review status and blocker codes enter the decision rule. Stored references name the
  repository review file/ID; no HTML, page wording, facility names, smoking-room pins or hours are extracted.
- `services/api/src/coverage/{seed-areas,campaign-areas}.ts`: hand-authored public geographic knowledge, with centres
  rounded to **two decimals** (roughly kilometre-scale). Additional centres were independently written for station,
  airport and district geographic units; no map POI download, geocoding, official smoking-pin extraction or OSM field
  supplied them. They exist only for approximate area matching/task presentation. Airport centres do not locate a room,
  and station centres do not identify an exit. The manifest itself has no coordinate fields.

There are no measured population or passenger-volume figures. `nationalHub`, `metropolitanHub`, `capitalStation`,
`capitalDowntown`, `largeTransfer`, `shinkansenHub`, `regionalHub` and `tourismHub` are reviewable qualitative public
urban/transport roles. They prioritize demand without pretending to be a population-weighted or top-300 station metric.
The licensed station and administrative-boundary reference-data gates remain `notComputableYet`.

From `services/api`:

```sh
npm run community:seed                              # Markdown on stdout
npm run community:seed -- --json                    # JSON on stdout (npm also prints its script header)
npm run community:seed -- --out /tmp/community-plan # writes campaign.json + campaign.md
npm run community:seed -- --fixtures --out ../data-pipeline/research/community-acquisition --write-seeds
npm run community:seed -- --coverage /tmp/coverage.json --stations /tmp/stations.json --out /tmp/refreshed-plan
node --experimental-strip-types --experimental-sqlite --no-warnings --test test/community-seed-campaign.test.ts
```

`--manifest FILE` and `--reviews FILE` select replacement inputs. `--fixtures --now ISO` selects a fixed snapshot
instant; fixture mode never accepts external coverage/station metrics. Every input is validated before output writes.
`--write-seeds` explicitly persists evaluated priorities/status/counts to the selected manifest, requires `--out`, and
is never implicit. Running normally does not write anything, fetch anything, contact D1 or create a spot.

External aggregate coverage uses `community-seed-coverage.v1`, `provenance: publishedCorpusAggregate`, a
`published-corpus:sha256:<64 lowercase hex>` revision, the fixed 1000 m radius, a timestamp, national tier totals,
`unassigned`, all 47 prefecture rows and area rows. Each `counts` object has `official`, `communityVerified`,
`visitedConfirmed`, `communityReported`, `allVisible`. `visitedConfirmed` is a subset of verified, never additive.
`--stations` accepts `{ measuredAt, corpusRevision, radiusMeters: 1000, areas: [{ seedAreaId, counts }] }`;
its date/revision must match coverage. It replaces supplied major-station rows only. Missing area metrics mean
**unknown**, not zero. Extra fields (pins, features, raw text), duplicate IDs, inconsistent totals and foreign areas
are rejected. Input ordering never changes output; no current clock, network or AI score is involved.

## Priority decision table (`community-seed-campaign.v1`)

| Measured area coverage | Public demand/evidence | Result |
| --- | --- | --- |
| 0–2 all visible | National/metropolitan hub, large transfer or Shinkansen hub | P0 |
| 0–2 all visible | Capital station/downtown, airport, or explicit official-information lead | P1 |
| 0–2 all visible | Other regional/tourism/collection area | P2 |
| 3+ all visible | Any area | P3 (still active unless the next rule applies) |
| 5+ all visible and 3+ official/communityVerified | Any area | P3, sufficientlyCovered |
| Metrics missing | Any area | P2, coverageUnknown; no zero-gap task |
| Manually blocked or retired | Any area | P3; no acquisition task |

The rule recomputes old priorities and counts; `sufficientlyCovered` reactivates if measured coverage later falls.
`blocked` and `retired` are explicit operator states and survive refresh. Official rights/coordinate blockers become
`officialRightsUnusable` / `officialCoordinatesUnusable` reasons, never source approvals or a reason to block independent
community investigation. JR East's bounded incomplete inventory and JR Central's pending research are linked as weaker
operator investigation context, **not** upgraded to explicit official evidence. Confirmations and unknown type/access
spot tasks continue even when an area is sufficiently covered; five spots do not assert that every place class is covered.

## Reports and Claude integration

`campaign.json` and `campaign.md` contain nationwide and 47-prefecture dashboards, P0–P3, all evaluated seeds,
132 uncovered major stations, high-value verification areas, top 20 and task-model output. Baseline: **232** zero-coverage
areas, 238 active seeds, 11 sufficiently covered; P0/P1/P2/P3 = **67/134/35/13**. There are **44 prefectures** with no
published spot. Seed representation 47/47 is not spot representation: the measured corpus remains 513 official spots
in Tokyo, Kyoto and Osaka, with community tiers 0.

PR #148's Community Acquisition Engine is integrated through the existing `SEED_AREAS` and `gapTasks` model.
All 249 campaign geographic units are in the public read-only `GET /v1/coverage/tasks` seed universe;
zero-visible seeds become `coverageGap` tasks. The generator adapter maps P0→1, P1→2, P2/P3→3 for the existing wire
vocabulary, without adding API/UI or inventing spot-task IDs. Runtime endpoint priorities remain the geographic
1/2/3 display tiers; the richer P0–P3 campaign is an operator plan. `desiredEvidence` preserves new-place discovery,
existence, exact-location, access and type requests locally. After a genuine observed pin is moderated/published,
the existing `needsConfirmation`, `needsLocationCheck`, `needsTypeCheck`, `needsAccessCheck` rules apply to that spot.
Airport evidence must distinguish terminal/floor, public vs ticketed/facility access and moved/closed rooms;
no campaign centre can answer any of those questions.

Metrics reuse the engine's per-source jurisdiction / approximate-seed assignment. Unassigned stays unassigned;
visited-confirmed is reported separately per prefecture and per seed. Area circles **overlap**: never add their spot
counts or mistake them for 500 m station-exit coverage. Neither station volume nor population coverage is claimed.

OSM safety: no feature-level OSM coordinate/id/name/tag/hour, third-party app record or source prose is committed or
consumed. Strict field allowlists and leakage/precision tests enforce structural boundaries; hand-authored geographic
provenance is also a review obligation, not something a regex can establish on its own.

## First 1,000 community spots: operational rollout (plan, not a measured forecast)

1. **Prepare before launch:** resolve #124 terms/publication rights through its owner; activate only through its normal
   approval. Assign an acquisition coordinator and two rotating moderators. Use the report queue, consent/App Attest,
   duplicate candidates and existing corrections; no seed bypasses these gates. Invite adult contributors with neutral
   geographic-research copy, no tobacco promotion/rewards. Outreach requires an authorized operator; this PR sends none.
2. **Pilot — 100 distinct accepted spots:** five zero-coverage P0 markets (Shinjuku, Shibuya, Nagoya, Sapporo, Hakata),
   target 20 distinct places per market. Recruit four local adult contributors per market through existing beta invitations
   and consenting local groups. Ask each for five independently observed places, including station surroundings and nearby
   commercial streets. Rotate an independent second contributor for confirmation; exclude duplicates and uncertain permission.
3. **Expand — +600:** the remaining 15 top-20 areas, target 40 distinct accepted spots each. Nominate a local coordinator,
   recruit roughly eight contributors per area, each aiming for five valid new places. Allocate café/restaurant, outdoor,
   facility and tobacco-shop-space walks as geographic investigation, never presume a business has smoking permission.
   The 600 is a capacity target; if an area lacks permitted places, reallocate to the next P0/P1 gap instead of fabricating.
4. **National floor — +235:** five distinct accepted spots in each of 47 prefectures (including prefectures already in the
   pilot). Use the capital station/downtown pair and an airport where applicable; ask one local collector and one independent
   verifier. This is a separately deduplicated increment, never recounting pilot spots. Prioritize the 44 zero-spot prefectures,
   with special focused sessions in Otsu, Fukui, Sakai, Miyazaki, Takamatsu and Nagasaki and rights-blocked official-lead areas.
5. **Airport/access sweep — +65:** target independently observed new places across 13 airport seeds, nominally five per
   airport: Haneda T1/T2/T3, Narita, New Chitose, Kansai, Fukuoka, Aomori, Sendai, Chubu, Naha, Hiroshima, Kagoshima,
   Matsuyama and Nagasaki. Local/travelling volunteers check only areas they may lawfully enter; record public/ticketed/customer
   access and exact room pin separately. Some airports have fewer eligible rooms; unused capacity moves to active P1 downtown
   seeds. Never copy operator floor-map pins or infer room existence from the airport. **100 + 600 + 235 + 65 = 1,000** unique,
   moderated community-origin spots, not 1,000 reports or confirmations.
6. **Daily review and weekly reranking:** keep a two-business-day triage target, review every report individually,
   track accepted unique / duplicate / rejected / pending / rights-blocked and independent confirmations separately.
   Refresh published aggregate counts and regenerate campaign weekly; rotate sufficiently covered areas toward uncovered gaps.
   Budget roughly 150 new-place proposals/week for 8–10 weeks (planning allowance for duplicates/rejections), plus separate
   independent confirmation work; adjust to observed acceptance and reviewer capacity after the pilot. No auto-accept.
   Success is 1,000 unique published community-origin spots after rights approval, 47/47 spot representation, transparent
   tier/access/freshness labels, and a rising independently confirmed share. If rights remain blocked, measure consented reviewed
   collection separately and state published community = 0; do not claim the public coverage milestone.

## Scale measurements and campaign progress

See [scale runbook](../../../../docs/COMMUNITY_SCALE_RUNBOOK.md). The explicit synthetic scale suite
uses this 249-seed universe; its approved simulation database never changes operational publication rights.
Campaign phase progress counts 100 + 600 + 235 + 65 unique community spots separately from confirmations.

### Aggregate progress command and versioned seed rules

Run from `services/api`:

```sh
node --experimental-strip-types --no-warnings scripts/campaign-progress.ts --spots /tmp/public-spots.json --out /tmp/campaign-progress
```

Input is a deduplicated array of public `TileSpotV1` records, never raw report data. Outputs `progress.json` and
`progress.md` include cumulative first-1,000 phases (100, 700, 935, 1,000), collected and verified counts,
remaining seeds, zero coverage, 47 prefectures, station coverage and airport coverage. The public-only CLI cannot
identify the visited-confirmed subset; it reports zero for that subset. The in-process `campaignProgress(spots,
visitedSpotIds)` adapter accepts the sanitized upgrade ID set when available. Simulation approval never activates
community publication; while #124 is open, published community progress remains zero.

`community-seed-progress.v1` recomputes `active` (zero visible), `progressing` (some visible), or
`sufficientlyCovered` from current overlapping 1 km coverage. Station thresholds are 5 visible / 3 official-or-verified;
airports are 3 / 2; downtown/nightlife are 8 / 4; other seed kinds are 3 / 2. Falling coverage deterministically
reactivates a seed. These are operational capacity rules, not evidence independence rules. The existing
`community-seed-campaign.v1` P0–P3 priority table and operator blocked/retired states retain their existing semantics;
the new progress dashboard exposes its separate, explicitly versioned capacity assessment.

Spatial grids prefilter coverage and prefecture assignment before exact haversine checks. Public coverage tasks use
one SQL statement with two bound values (JSON seed manifest and radius), indexed coordinate probes and snapshot
membership checks. A guaranteed inner path proves coverage cheaply; ambiguous boundary candidates still receive
exact distance checks. Response cardinality remains at most 249 tasks, preserving no-query client compatibility.

The public task query caps temporary candidate materialization at 4,096 rows plus one overflow detector.
Overflow yields an explicit HTTP 503, never a truncated coverage claim. This guard handles adversarial outer-ring
layouts that have no guaranteed inner coverage; regular dense areas short-circuit to a single sentinel.
