# ADR-0013 — Community acquisition engine for nationwide coverage

Status: **Accepted** (2026-10-01, maintainer-directed macro task; child of #67).

Implementation: migration `0024_community_acquisition.sql`; `services/api/src/reports/{dto,create,triage}.ts`,
`src/pipeline/community-{absence,evidence}.ts`, `src/coverage/{tasks,seed-areas,prefectures,metrics,targets,dto}.ts`,
`GET /v1/coverage/tasks`, `scripts/{report-queue,coverage-targets}.ts`; contract `contracts/coverage/coverage-tasks.v1.json`;
Apple `Domain/Verification/CoverageTasks.swift`, `Domain/Search/DuplicateCandidates.swift`,
`Features/Reports/{ReportDomain,ReportModel,ReportFormView,QuickConfirmView}.swift`, `Features/Nearby/SpotDetailView.swift`,
`ContentView.swift`, Watch `ContentView.swift`.

This ADR does **not** approve Issue #124. The community source stays `blocked`, the report terms stay a `pending` draft,
and every user-derived listing, hold and task stays unpublished until both are granted. It makes the channel ready so
collection can start the moment they are.

## Context

ADR-0012 made lower-confidence community data technically publishable. Official open data cannot reach nationwide
usefulness on its own: the research replay found 33 of 61 reviewed targets blocked only because the official data does
not carry the smoking place, and convenience-store ashtrays, cafés and small corners never appear in it. The community
channel therefore has to be a first-class acquisition path: easy to contribute to, structured, corrected by more
evidence rather than by one voice, and measurable — without turning MannerPath into a record of where people go.

## Decisions

1. **Lifecycle.** A community spot moves `reported` (one moderated report, tier `communityReported`) →
   `visitedConfirmed` (one other, independent person confirmed it on site: an applied `exists` upgrade, two submitters)
   → `communityVerified` (two submitters at creation, or three or more). The published tier stays ADR-0012's two values;
   the stage is a named refinement (`communityStage`, `community-evidence.v1`). Repeats from one submitter never count.
2. **Structured findings, not reviews.** Existing-spot reports are categorical evidence: `exists` ("it was here"),
   `notFound`, `removed`, `moved` (with a pin), `typeChanged`, `accessChanged`, `hoursChanged`, `tobaccoTypeChanged`,
   `prohibited`, `other`. The three new types are stored as `other` + `finding` because SQLite cannot widen the populated
   `report_type` CHECK; on the wire they are first-class and gated by `/v1/config` `reports.existingSpotFindings`.
   Corrections may carry the proposed categorical value; never free text beyond the existing `note`.
3. **One-tap confirmation.** "It was here" sends `exists` with the spot ID only — no note, date or location — through
   the existing terms consent and App Attest path. The client remembers the exact terms version the user explicitly
   agreed to, so a repeat confirmation is two taps; a different version is never treated as agreed.
4. **Negative evidence never deletes on its own.** One accepted `notFound`/`removed` → `needsRecheck` (a signal). Two
   or more independent negatives newer than every positive → `reviewCandidate`. A reviewer proposes and applies an
   immutable **absence review** (`community_absence_applications`), which changes nothing public; the one public step,
   `holdCommunityAbsence`, unpublishes the spot and is refused by the database unless two independent fresh submitters,
   consent under a granted terms version and an approved community source all hold. Holds are lifted, never deleted.
   Stale ≠ removed (ADR-0012 decision 4). Official closure evidence keeps its stronger, existing path: a source release
   that drops the record goes through removal review (ADR-0006/0009).
5. **Location correction is first-class but never immediate.** `moved` pins from distinct submitters that agree
   within 30 m become a `relocationCandidate`; one pin is `awaitingIndependentConfirmation`. The relocation itself goes
   through the existing reviewed relocation workflow (ADR-0009); no report writes a coordinate.
6. **Conflicts are not votes.** Per spot the rule reads the order and independence of accepted positive and negative
   reports: a newer positive supersedes older negatives; mixed fresh evidence from different people is flagged
   `conflicting` for review. There is no score and no majority rule; official evidence outranks reports.
7. **Duplicate prevention without merging.** Before a new spot is added the iPhone shows listed places within 50 m
   ("Is it one of these?") from data already on the device, and can turn the draft into a confirmation of that place.
   Reviewers see the same 50 m duplicate candidates. Nothing merges automatically; cross-source / identity review stays
   the only merge path.
8. **Coverage tasks are public, read-only and unassigned.** `coverage-tasks.v1`: `needsConfirmation`,
   `needsLocationCheck`, `needsTypeCheck`, `needsAccessCheck` follow from a published spot's own fields, so clients
   derive them locally (TS and Swift share contract vectors); `coverageGap` follows from seed areas with no visible spot
   (`GET /v1/coverage/tasks`, no request parameters); `needsRecheck` follows from reports and is public only once rights
   are granted. A task names a spot ID or an approximate area and a kind — never a reporter, report, date or count.
9. **Nearby prompts are light.** The Nearby screen shows up to three nearby places waiting for confirmation, which the
   user can hide. No push notification, no streak, no reward, no ranking of contributors, no background location.
10. **Seed areas are collection priority, not data.** `seed-areas.v1` lists national hubs, every prefecture's main
    station, airports, tourist hubs and a few university areas with approximate centres. Nothing in it claims or implies
    that a smoking place exists, and nothing in it is ever published as a spot.
11. **Metrics keep official honest.** Quality adds `nationwide.communityAcquisition`: published official / reported /
    visitedConfirmed / communityVerified, spots needing confirmation, stale, corrections pending, coverage gaps,
    confirmations in 7/30 days, 47-prefecture coverage (official, community verified, reported, all visible) and seed-
    station coverage official-only vs all-visible. Official counts are never inflated by community counts. Prefecture
    assignment is by source jurisdiction, or for community spots only inside a seed area (approximate) — otherwise
    `unassigned`, never guessed. The licensed top-50/top-300 station metric stays `notComputableYet`.
12. **Moderation scales without auto-acceptance.** Triage filters by category, flags `duplicateCandidate`,
    `highReportCount`, `conflicting` and `old`, orders flagged-first then oldest-first, and summarizes pending /
    accepted / rejected / applied / rightsBlocked. There is no bulk accept: every decision is a single reviewed call.
13. **Venue/operator claims later, without a schema rewrite.** Community claims arrive through the `userReport` source.
    A future venue/operator self-registration is a *separate* source kind (ADR-0008's `operator`, its own registry row,
    terms and attribution), so its claims stay distinguishable from community ones by provenance and the existing
    `verification.existence` `operator` tier. No account system is built now.
14. **Photos are out of scope.** There is no upload/storage/moderation infrastructure; photo evidence is a separate
    future issue ("Community evidence photo attachments").

## Privacy (ADR-0007)

A confirmation is evidence about a **spot**, not about a person. Migration 0024 adds no coordinate, device position,
route, timestamp of movement or per-user index; a finding is a categorical fact that survives redaction; the 90-day
minimization of notes, pins, observed days and submitter keys is unchanged (`test/community-acquisition.test.ts`
asserts the migration's column set and the redaction). Nearby tasks and duplicate suggestions are computed on the
device from tiles it already holds; no request carries the user's location.

## Consequences

- When #124 is granted and the community source approved, reported spots publish, confirmations promote them, absence
  holds can withdraw them and recheck tasks become public — with no further code.
- The quality report and `npm run coverage:targets` give the first seed campaign its targets.

## Amendment 2026-10-01 — nationwide community seed campaign (#149)

The collection channel now has a coordinate-free, machine-readable 249-area manifest spanning 47 prefectures and
all 52 #145 official-information groups. `npm run community:seed` deterministically combines aggregate published
counts, station-area metrics and projected official review verdicts. Priority is an explicit P0–P3 decision table
(sparse coverage plus public urban/transport roles and official lead evidence), never an AI/population/passenger score.
Missing metrics stay unknown; sufficiently covered areas reactivate when coverage falls, and blocked/retired are
operator states. Exact rules, input schemas and first-1,000 rollout are in the campaign README.

Existing `SEED_AREAS` / `gapTasks` and `GET /v1/coverage/tasks` carry the campaign's zero-visible areas as `coverageGap`;
no wire/task/UI model is replaced. The operator adapter maps P0→1, P1→2, P2/P3→3. Existence/location/access/type
requests remain local campaign instructions until a contributor independently observes an actual spot and submits
its exact pin. Additional approximate centres are two-decimal, hand-authored public geographic units, never copied
official smoking-room/OSM/third-party coordinates. Seeds cannot enter canonical spots or tile publication.

`seedAreaCoverage` reports overlapping per-area official/verified/visited-confirmed/reported/all-visible counts;
prefecture rows now also expose visited-confirmed as a subset of verified. The licensed top-50/top-300 and population
coverage gates, source approval and Issue #124 remain unchanged. 47/47 seeds does not establish 47/47 spot coverage.
- A deployment before 0024 keeps working with new clients: they read `existingSpotFindings` as false and fall back to
  the earlier report types.
