# Nationwide and account readiness

Date: 2026-10-07. Audited main: `55372bfddf65958bb7a3dbf7a9aec4a8d9b7181c` (#209 merged).
Status: architecture proposal, not activation approval or an accepted replacement ADR.
No code, migrations, Apple UI, production data or remote resources change here.

Classification: **READY NOW** = existing supported boundary; **PREPARE NOW** = document/measure before use;
**IMPLEMENT AFTER V1** = optional feature after release; **IMPLEMENT WHEN SCALE REQUIRES** = measured trigger;
**MAINTAINER DECISION** = policy/product authorization; **DO NOT IMPLEMENT** = prohibited shortcut.
No blocking gap requiring a code/schema change before this architecture can proceed was found.

## 1. Current architecture

**READY NOW.** Follow [ARCHITECTURE](../ARCHITECTURE.md), [API](../API.md),
[SPECIFICATION](../SPECIFICATION.md), [nationwide strategy](../NATIONWIDE_DATA_STRATEGY.md),
and ADRs [0006](../adr/0006-evidence-and-publication.md), 0008, 0009, 0011, 0014, 0015 and 0017.
ADR filenames are listed in `docs/adr/`; their accepted decisions remain authoritative.

- Source registry and six municipal adapters separate raw releases/observations, reconciliation and publication.
  Approval requires smoking-place existence evidence, reuse rights, attribution and coordinate authority.
  Host existence alone is not evidence. Confidence and location precision remain independent.
- Canonical public D1 uses the actual Worker binding `DB` (called DATA_DB conceptually below).
  Stable spot IDs survive reviewed relocation; cross-source merges/conflicts require reviewed decisions.
  Merged IDs have detail redirects. Coordinate proximity alone cannot authorize a merge or relocation.
- Promotion bundles support segmented v4 deterministic export/import, hashes, bounded statements,
  completion ledgers and fresh GREEN readiness. Partial imports cannot become complete publication.
- Fixed z14 snapshots serve manifest/parts with ETags. Per-part bounds: 250 spots, 64 KiB SQL-literal
  bytes, 16 KiB gzip; maximum 128 parts/tile and 16 KiB manifest. Bytes can bind before spot count.
- Public detail is publication-membership gated. Source attribution/license travels with public DTOs.
  Client cache replacement is atomic per logical tile after complete parts; 304 preserves cache,
  authoritative 404 removes that tile, revision/namespace guards reject stale responses.
- REPORTS_DB is durable and independent of rebuildable DATA_DB. Sanitized, reviewed evidence artifacts
  cross that boundary; raw reports, identity and moderation do not enter public promotion bundles.
- Reviewed derived-coordinate foundation remains inert: policy `proposed`, reviewed dataset pins `[]`,
  no resolver/publication connection. #209 replay: 26 candidates, current passing 0, simulated best-case 0.
  Approval alone adds no coverage; rights, operations and activation work remain independent.
  See [readiness packet](../research/2026-10-07-derived-coordinate-readiness.md).

## 2. Nationwide scaling

**READY NOW** for continued approved-source expansion using current tile contracts.
Counts below are capacity evidence, not forecasts of remote throughput or approval of synthetic community data.
[Promotion measurements](../research/2026-10-segmented-promotion.md) and
[tile measurements](../research/2026-10-scalable-tile-delivery.md) used local Node/SQLite.

| Scale | Ingestion / D1 | Promotion / generation | Delivery / client | Classification |
| --- | --- | --- | --- | --- |
| 1,000 | Existing release/adapter pipeline; source review and rights likely dominate onboarding. Measure raw history and indexes, not only published rows. | Synthetic 1k + 513 official: full roundtrip, 10.58 MB artifact, 366 tiles/parts, bootstrap 2.381s, peak 0.404 GiB. | Bounded regional tile cache; no national download required. | READY NOW, remote performance unproven |
| 10,000 | Same architecture; record matching and repeated releases increase work/storage. | Synthetic 10k + 513: full roundtrip, 65.31 MB, 439 tiles/464 parts, max 6 parts/tile, bootstrap 28.807s across chunks, peak 0.689 GiB. | Density, request counts and eviction need measurement; total count alone does not enlarge every response. | READY NOW locally; PREPARE NOW operational measurement |
| 100,000 | No full 100k end-to-end validation. Measure ingestion matching, historical growth, indexes and concurrency before claiming capacity. | 50k proxy completed: 308.80 MB, 453 tiles/810 parts, max 24 parts/tile, 288 chunks, bootstrap 104.480s, peak 2.477 GiB. Full 100k publication/finalization/memory still required. | Real dense-region latency, cache size and viewport scheduler are unverified. 128-part cap can refuse concentration even below 100k. | IMPLEMENT WHEN SCALE REQUIRES; PREPARE NOW benchmark plan |

Likely first pressure points are review throughput, local publication/cross-source memory and dense-neighborhood
request fanout, rather than a national spot count requiring new endpoints. This is an inference from local data.
The 50k model measured z14 neighborhood p95 55 requests / 98,693 gzip bytes; max part 65,532 raw /
3,975 gzip bytes and max manifest 2,634 bytes. These are modeled 3×3 requests, not device latency/battery.
The present client loads a bounded device/destination neighborhood; arbitrary map panning is not a general
nationwide viewport fetch scheduler. A future viewport loader needs bounded concurrency, cancellation,
deduplication, revision consistency and cache eviction, while reusing tiles.

**PREPARE NOW:** record actual D1 size including raw releases/provenance/indexes, per-query rows read,
query duration, request rate, generation RSS/time, artifact/chunk/manifest size, per-tile part distribution,
real device cache growth and dense/sparse latency. Authorized remote capacity validation is later work.
Cloudflare currently documents paid D1 10 GB/database, free 500 MB, 100 KB SQL statements, 2 MB rows,
30s query/batch limits and per-database serialized execution; plan and query duration matter.
See [official D1 limits](https://developers.cloudflare.com/d1/platform/limits/) (checked 2026-10-07).

**IMPLEMENT WHEN SCALE REQUIRES:** use real dense-region measurements to reconsider z15 through the
existing config/namespace contract and ADR review; z15 loses sparse-region coverage and does not solve
extreme density by itself. Existing benchmark proposes reconsideration above real p95 ~33 requests.
Do not raise part budgets to hide refusal. Consider storage partitioning/read replication or PostGIS only
if measured storage/concurrency or new corridor/polygon queries cannot be served by indexed bounded tiles.
No claim that 100k remote production is proven; no count-based rewrite or z change now.

## 3. Source onboarding

**PREPARE NOW.** Workflow states below describe review gates, not new database enums:

| State | Required exit evidence | Human responsibility / automation |
| --- | --- | --- |
| discovered | Publisher identity, smoking-specific claims, release URL/digest | Human canonical-authority check; automate catalog/URL drift checks |
| rights reviewed | Approved reuse terms, attribution, processing notice, license URL/version | Human legal/policy decision; automate pinned terms diff, never auto-approve |
| coordinate authority reviewed | Publisher coordinates or reviewed permitted precision path | Human exact/approximate/derived decision; automate schema and bounds validation |
| adapter implemented | Versioned parser, fixtures, natural-key semantics, attribution | Human semantics/code review; reuse adapter interface/boilerplate and fixture tests |
| local pipeline | Deterministic release ingest, reconciliation, conflict/relocation holds | Automate repeatable fresh-local runs; human adjudicates conflicts |
| quality | Evidence/rights/precision/freshness gates and removed/moved review | Automate quality/drift reports; human reviews substantive changes |
| promotion | Verified deterministic bundle, completion/parity, all gates | Automate export/verify/local GREEN replay; human approves reviewed registry decisions |
| production | Authorized deployment/cutover and rollback checks | Maintainer-controlled operation; no source discovery job may activate publication |

Continue source addition now through these gates. Existing adapters offer registry/parser conventions,
not a guarantee that every publisher format has a ready generic importer. Automate scaffolding and
release monitoring as source count grows, without substituting automation for reuse-rights review.

Source updates retain raw release and adapter version/digests. A removed entry is not automatically proof
of closure: classify omission versus explicit cessation, review publication withdrawal/freshness.
Moved smoking places enter ADR-0009 relocation review with stable IDs; never silently remint IDs.
URL changes require publisher/rights continuity checks; license changes hold new publication until reviewed.
Publisher coordinates arriving after approximate/derived data require provenance-preserving reviewed relocation.
Cross-source overlap requires reviewed identity/conflict resolution, not nearest-neighbor deduplication.
Address-only sources remain evidence candidates: use ADR-0017 only with reviewed same-publication area
anchors; ADR-0011 geocoding publication remains prohibited until its separate prerequisites are met.
Fuchu/Hiroshima/Bunkyo rights blockers cannot be bypassed by coordinate derivation.

## 4. API evolution triggers

Public API evolution is additive. Source count growth alone requires no new endpoint.

| Capability | Timing / concrete trigger |
| --- | --- |
| Tile API | READY NOW: retain z14 manifest/parts, ETag and complete-snapshot semantics. Change only for measured budgets/latency or new spatial requirements. |
| Detail API | READY NOW: retain public published-spot detail and merged-ID redirects; source growth adds records, not an account requirement. |
| Full-text spot search | IMPLEMENT AFTER V1 if product needs canonical smoking-place name search beyond locally cached candidates. MapKit destination search remains separate; never forward raw destination queries/GPS by default. |
| Regional search | IMPLEMENT WHEN SCALE REQUIRES if bounded regional tiles cannot meet an approved query need. Define region/result completeness; avoid unbounded nationwide scans. |
| Server-side filter | DO NOT IMPLEMENT merely for source growth. Consider after measured download cost or uncached query requirements; unknown is not false and precision is independent of evidence. |
| Favorites sync | IMPLEMENT AFTER V1 with optional account, explicit sync consent and stable-ID redirect handling. |
| Report status/history | IMPLEMENT AFTER V1 only after ownership/privacy/retention policy; reportId alone cannot authorize reads. |
| Account profile | IMPLEMENT AFTER V1 only for needed account settings/deletion, no speculative social profile. |
| Pagination | IMPLEMENT WHEN SCALE REQUIRES for bounded search/account collections using stable opaque cursors; tile parts already have their own complete-snapshot protocol. |
| Bulk sync | DO NOT IMPLEMENT nationwide download by default. Consider bounded regional batch/delta protocol only when request/cache measurements justify it, preserving revision and deletion semantics. |

**Now required API changes: none identified.** Public `/v1/config`, `/v1/tiles` and `/v1/spots`
remain anonymous and cacheable as currently specified. Account routes must not wrap public reads in login middleware.
Potential private minimum: auth exchange/revoke, `GET /v1/me` and account deletion when login ships;
`GET /v1/favorites`, idempotent `PUT/DELETE /v1/favorites/:spotId` when sync ships.
`GET /v1/reports/mine` only after future-report ownership approval. `/auth/*` is a proposed namespace,
not a committed contract. Do not add unused preferences/profile/search/status endpoints.
Private responses use authenticated authorization and no shared public caching; errors must not disclose other users.

## 5. Account use cases

**MAINTAINER DECISION:** account value must precede infrastructure work.
Favorites/preferences sync and multiple-device recovery are plausible optional uses. Future report history
and moderation notifications need explicit ownership policy. No current browsing/navigation feature requires
an account. A sync destination necessarily needs authorization, but anonymous local favorites can remain usable.
Do not make account creation a v1 release prerequisite or treat registration as evidence of smoking-place existence.

## 6. Identity model

**PREPARE NOW:** preserve distinct namespaces and responsibilities:

| Concept | Current state / future purpose |
| --- | --- |
| UserAccount | Absent. Future opaque internal ID; explicit opt-in human account, not proof of unique human. |
| DeviceInstallation | Local report install UUID exists, client-selected and not stored raw on server. Future revocable association only if needed; no tracking ID required for browsing. |
| AppAttestKey | REPORTS_DB public key/counter/environment/registration state; integrity/replay/abuse signal, not login. |
| Session | Absent. Future revocable account authorization, distinct from attest challenges and provider tokens. |
| ReportSubmitter | Pseudonymous report rate/independence identity, not account ownership. Schema1 hashes install UUID; schema2 hashes verified key-derived identity with pepper. |

`AppAttestKey != UserAccount`; `DeviceInstallation != UserAccount`; `ReportSubmitter != UserAccount`.
Provider subject maps via provider/issuer namespace to internal account ID; neither becomes an installation/key ID.
Report receipts contain reportId/pending/time, not a secret ownership capability. Photo attachment currently
checks the verified submitter against the report's hash; it does not establish account ownership.
Rate limits use submitter hash (10/hour, 50/day, best-effort under concurrency), not user login.
Attest challenges expire after 300s; registered key state is currently retained indefinitely.
The October 1 amendment to ADR-0007 supersedes older prose implying reports cannot correlate to keys:
key-derived submitter hashing permits correlation within the report retention window.

## 7. Anonymous-first model

**READY NOW:** Map, Nearby, Detail, navigation, offline and source/license remain account-free.
Anonymous reporting remains possible where report intake/activation policy permits, with existing abuse controls.
Account absence does not bypass attestation, consent or moderation requirements.

**IMPLEMENT AFTER V1:** on explicit sign-in, offer consented local-favorites/preferences upload with clear merge
rules, deduplication by stable spot ID and opt-out/local-only behavior. Do not silently transfer device history.
Signing out revokes sessions and removes private cached account data without erasing public offline tiles.
A new device/account association is consented and revocable; App Attest registration remains separate.

**DO NOT IMPLEMENT:** automatic claims of past anonymous reports using install UUID, reportId or sign-in.
Default recommendation is no historical linkage. Optional ownership of future submissions needs consent and
proof at submission. A historical claim feature would require a separate privacy decision, retained original
signing proof, recovery/deletion rules and cannot reconstruct identities after 90-day minimization.

## 8. Authentication recommendation

**MAINTAINER DECISION**, implement after v1 only when an account feature is approved.
Recommend Sign in with Apple first for this iOS-first product, with server-verified identity token claims,
issuer/audience/expiry/nonce checks, provider-subject mapping and independently revocable application sessions.
This is a design recommendation, not an assertion that integration exists.

| Candidate | Assessment |
| --- | --- |
| Sign in with Apple | Minimal first provider for iOS; still requires token validation, recovery/revocation and deletion design. |
| Passkey | Strong future option; requires relying-party domain, server challenges/credential validation and recovery UX. |
| Email magic link | Possible cross-platform fallback; adds email delivery, anti-enumeration/abuse and retention responsibilities. |
| Password | DO NOT IMPLEMENT self-managed passwords without a compelling product requirement and separate security review. |
| Third-party OAuth | Defer unless real user need; more provider/linking and review obligations. |

Apple review rules address optional login and qualifying alternatives for third-party login;
account creation requires in-app account deletion. See
[review guidelines](https://developer.apple.com/app-store/review/guidelines/) and
[account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).
Provider documentation: [Sign in with Apple](https://developer.apple.com/sign-in-with-apple/),
[passkeys](https://developer.apple.com/passkeys/). Review exact provider contracts before implementation.

## 9. Storage boundary

**MAINTAINER DECISION:** recommend a dedicated durable ACCOUNT_DB when accounts are implemented,
not a binding, migration or database to create today.

| Choice | Evaluation |
| --- | --- |
| REPORTS_DB | Reuses durability, but couples login/favorites retention, deletion/export and releases to moderation/abuse data; larger privilege and failure blast radius. Not recommended default. |
| ACCOUNT_DB | Independent schema/deploy/rollback/retention; least-privilege account service; isolates sensitive moderation and public blue/green operations. Costs extra operations and explicit cross-store consistency. Recommended. |
| Public DATA_DB | DO NOT IMPLEMENT account/private data here: rebuildable public promotions, cache/export paths and blue/green rollback are incompatible boundaries. |

No cross-DB foreign keys or implicit distributed transactions. Account/report linkage uses opaque references,
minimal authorized context and idempotent lifecycle jobs; design failure/retry behavior before it ships.
Preserve ADR-0014 separation: public reads do not require REPORTS_DB, private report routes do not fall back
to DATA_DB. Account additions require explicit architectural review of new private-service access, not
cross-store joins in public endpoints. Private account snapshots/tokens never enter public promotion/tiles.

## 10. Privacy

**PREPARE NOW:** retain [inventory](../APP_PRIVACY_INVENTORY.md) and
[production audit](../PRODUCTION_PRIVACY_AUDIT.md) as release evidence. Existing UNKNOWNs include provider
logging/retention/linkage, geographic request paths, signed-device behavior, support hosting/mailbox,
analytics/exports and diagnostic exception fields. Account design resolves none of them.
Do not claim anonymous traffic is uncollected merely because there is no login.

- No server browsing history or raw GPS history. Tile paths can still imply coarse geography;
  operational logs need separately reviewed minimization/retention.
- Sync is explicit and limited to selected favorites/preferences. Account identifiers and linked favorites,
  reports or contact details change the privacy inventory and label assessment.
- Explain report-location/account linkage before optional ownership. Raw report minimization currently
  removes notes, proposed pin, observed day, submitter hash and free text after 90 days regardless of moderation.
  An account must not silently extend it. Rate windows expire plus 24h; attest-key retention needs separate review.
- Define deletion, session/provider revocation, export scope, backup retention and cross-store retry handling
  before account launch. Export must not expose others' reports or protected moderation/abuse material.
- Delete account-associated user photos/text/reviews on account deletion unless legally required to retain
  them, following Apple guidance. Removing an ownership link alone is not a blanket UGC deletion exemption.
  Genuinely independent public spot facts may survive under an approved policy after personal linkage removal;
  define which sanitized evidence qualifies and explain remaining retention before account launch.
- No tracking/ad targeting or account-based browsing analytics by default.

Apple disclosure categories and linkage must be assessed against actual deployed flows, including processors,
not copied from this conceptual model: [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/).

## 11. Reports/community relation

**READY NOW:** `raw report != published spot`; `account != trusted evidence`;
`multiple accounts != independent submitters`. App Attest is a security/abuse signal, not existence evidence.
Distinct key-derived hashes reduce simple install-ID rotation but do not prove distinct humans.
Future account reputation requires a separate evidence/policy decision; it cannot lower ADR-0006 gates.
Community rights/terms/consent, moderation and publication activation remain separately approved under
[community decision](../legal/COMMUNITY_PUBLICATION_DECISION.md) and
[launch checklist](../COMMUNITY_LAUNCH_CHECKLIST.md). Login does not activate community publication.
Sanitized artifacts retain evidence semantics and exclude account IDs, submitter hashes and raw personal content.

## 12. Migration strategy

**Now: DO NOT IMPLEMENT migrations.** Define these future models only as required:

| Conceptual table | Necessity |
| --- | --- |
| accounts | At account launch: internal opaque ID and lifecycle/deletion state; minimal profile only. |
| auth_identities | At provider login: unique provider/issuer/subject mapping; explicit proof before linking providers. |
| sessions | At account authorization: independently revocable sessions; never plain reusable secrets in public data. |
| installations | Only if device revocation/association is needed; avoid universal browsing tracking. |
| favorites | Only when explicit sync ships; stable spot references, merged/deleted-spot handling. |
| user_preferences | Only when approved preferences sync ships; local-only settings need no table. |
| report_ownership | Only after future-report ownership/retention policy approval; no automatic legacy backfill. |

Account foundation begins after v1 when the first optional sync/history use case and privacy/provider/storage
choices are approved. Use a separate durable migration stream with additive rollout, idempotent cleanup,
revocation and deletion/export tests. Public corpus promotions must never rebuild it.
No current schema needs speculative account columns; no irreversible linking/backfill now.

## 13. Versioning

**PREPARE NOW:** keep public schemaVersion/config/ETag/namespace and legacy tile behavior.
Multipart legacy responses fail explicitly rather than return partial snapshots; old apps keep valid cached
content according to existing contract. Account addition must not introduce mandatory authorization or
user-specific fields into public DTOs/cache keys. Private API contracts version independently.
Test old public client compatibility, complete parts/304/404, stale namespace responses, merged IDs and offline
at release. Watch currently transfers up to 500 public nearest spots plus attribution/preferences through
paired WCSession; App Group Widget files contain public glance data, not account credentials.
Neither transport ID nor App Group entitlement is user identity. Keep public Watch/Widget working without login;
future private sync needs separate revocation/privacy design, not token sharing in existing snapshots.

## 14. Recommended phases

| Phase | Work / classification |
| --- | --- |
| A — v1 integrity | PREPARE NOW: retain anonymous contracts, finish existing UI/release work in its own lane, reconcile privacy UNKNOWNs, source/rights/rollback checks. No account prerequisite. |
| B — official expansion | READY NOW: add reviewed sources, fixtures, release/relocation review and quality/promotion through current pipeline. |
| C — onboarding automation | IMPLEMENT AFTER V1 as review workload requires: scaffolding, terms/URL/schema drift and deterministic local verification, never automatic rights approval. |
| D — capacity measurement | PREPARE NOW plan; IMPLEMENT WHEN SCALE REQUIRES full 100k local roundtrip, real dense/sparse device tests and later authorized remote capacity tests before claiming production readiness. |
| E — account foundation | IMPLEMENT AFTER V1 after maintainer approves use case, provider, ACCOUNT_DB boundary, deletion/export/retention and anonymous-report policy. |
| F — optional sync | IMPLEMENT AFTER V1: favorites first, preferences only if useful; explicit opt-in, independent IDs and sessions. |
| G — community activation | MAINTAINER DECISION: rights/terms, moderation, abuse, operational and evidence gates independently complete; account not a prerequisite or trust shortcut. |

Decide boundaries now: public/private stores, independent identities, anonymous public API, no historical
report auto-claim, immutable evidence/precision semantics, additive compatibility and measurement triggers.
Decide implementation details when corresponding features are approved. No login implementation,
account schema, source approval, derived/community activation or production mutation is authorized by this document.

Validation for this docs-only change: `make contract`; `git diff --check`.
#209 landing separately passed API 866, discovery 78 and focused derived-coordinate 20 tests,
contract/diff checks and unchanged replay current passing 0. These do not certify future account or 100k capacity.
