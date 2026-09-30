# ADR-0007 — User report privacy, retention and moderation

Status: Accepted (2026-09, Issue #29). Amended 2026-09 by the PR #36 review: App Attest deferred
(§6), moderation notes replaced by a bounded reason vocabulary (§4), reconciliation transitions
narrowed to the ones this slice can honestly make (§2). Amended 2026-09 by Issue #37: App Attest
implemented as a server-issued challenge / key registration / request-bound assertion protocol
(§6), report request schema 2. Amended 2026-09 by Issue #123: `queued → applied` implemented by
community reconciliation (§2, §8, "Amendment — community reconciliation" below).

Prerequisite for the report API. ADR-0006 ends with "Report privacy/retention requires a separate
ADR before the report API ships"; this is that ADR. It governs `POST /v1/reports`
(`docs/API.md`), migration `services/api/migrations/0003_reports.sql` and
`services/api/src/reports/`.

## Context

Users can tell us that a spot is missing, gone, moved, or that its hours, access or tobacco-type
support changed. That is the only user-generated content the product accepts, and it is inherently
sensitive: a report is a statement that a person was at or near a place at a time, made by a
smoker, about smoking. A naive implementation would turn the report table into a location history
of its submitters.

The report endpoint also has no trust anchor: anything a client sends is an unauthenticated claim.
Canonical data is evidence-backed and publication-gated (ADR-0006), and nothing arriving over the
public API may weaken that.

## Decision

### 1. A report is an immutable proposal, never a canonical mutation

A report is an append-only event in its own table space. It never writes `spots`,
`spot_field_provenance`, `source_records` or any published table, directly or indirectly, and no
code path in the report slice touches them. `reports.subject_spot_id` is deliberately **not** a
foreign key to `spots`: the claim is stored as the client made it, an unknown or unpublished ID is
accepted unchanged, and the report layer therefore cannot be used to probe which canonical spots
exist. A database trigger rejects every update to a stored report except the redaction described
in §4.

### 2. Accepted ≠ evidence

Moderation state and reconciliation state are separate, explicit columns
(`services/api/migrations/0003_reports.sql`):

- `state`: `pending | accepted | rejected | duplicate | needsInfo`. A report is created `pending`;
  a decision requires a decision time and a decider, and cannot return to `pending`.
- `reconciliation_state`: `notQueued | queued | applied | discarded`, and it may leave `notQueued`
  only while `state = 'accepted'`. The transitions that exist **today** are exactly:

  | From | To | Allowed |
  |---|---|---|
  | `notQueued` | `queued` | yes (report must be `accepted`) |
  | `notQueued` | `discarded` | yes (report must be `accepted`) |
  | `queued` | `discarded` | yes |
  | `queued` | `applied` | only in the apply batch of an applied community reconciliation application that links the report (Issue #123, migration 0020) |
  | `notQueued` / `discarded` | `applied` | **no** |
  | `queued` / `discarded` / `applied` | `notQueued` | **no** — backward |
  | `discarded` / `applied` | anything | **no** — terminal |

  `applied` is reachable only through reconciliation (Issue #123): the transition trigger accepts it
  solely for a report linked to an application that is already `applied` in the same batch, a row
  is still born `notQueued`, and the moderation module's type still does not offer it. Neither the
  module nor the `queue` CLI command can claim that reconciliation was applied.

Accepting a report records a human judgement that the claim looks true. It does **not** make the
report canonical evidence and does not change any published tile. Turning an accepted report into
evidence is a separate, deliberate reconciliation step: it registers a `userReport` source through
the reviewed source registry and goes through the ordinary ingest → resolve → publish path with
the ADR-0006 publication invariant intact. That step exists since Issue #123 for new-spot proposals
(see the amendment below); every other report type still stops at `queued`.

### 3. Payload minimization

The accepted payload is the smallest set that makes a proposal actionable. It is fixed by a strict
Zod schema (`services/api/src/reports/dto.ts`); anything else is rejected, not ignored.

| Field | Why it is accepted | Constraint |
|---|---|---|
| `type` | what is being proposed | one of the eight v1 report types |
| `spotId` | which spot the claim is about | required except for `missing`, forbidden for `missing` |
| `proposedLocation` | where the proposed/moved spot is | **only** for `missing` and `moved`; rejected for every other type; stored rounded to 5 decimal places (~1 m), the precision canonical spot data already uses |
| `observedOn` | when the submitter saw it | a real calendar date at day precision, `YYYY-MM-DD` (`z.iso.date()`), with a matching database CHECK; no time of day, so a report cannot place someone at a place at an hour. No future-date restriction |
| `note` | free-text detail a moderator needs | optional, ≤ 280 characters |
| `installId` | abuse control only | client-generated UUID, never stored as sent (§5) |
| ~~`attestation`~~ | — | **never part of the report payload**. Schema 1 accepts none; schema 2 carries it in the envelope beside the signed payload, and only a verdict is stored (§6) |

Explicitly **not** accepted and never stored: the device's own position, any trajectory, bearing,
accuracy or sensor data, a sequence of positions, a user account, an email address, an IP address,
a `User-Agent`, a timestamp of finer than day precision supplied by the client, or any identifier
that is stable across app reinstalls (IDFA/IDFV/DeviceCheck bits). **No raw location history is
collected**: at most one coordinate per report, and only when the report type is about a location.
The client sends the map pin being proposed, not the device position; `docs/API.md` states this as
a client obligation.

### 4. Retention

- `received_at` (server time) and `minimize_after = received_at + 90 days` are stored with the
  report.
- After `minimize_after`, **minimization runs regardless of moderation state**: `note`,
  `proposed_latitude`, `proposed_longitude`, `observed_on` and `submitter_hash` are set to NULL and
  `redacted_at` is recorded. An unmoderated backlog is therefore not a retention loophole.
- What survives redaction is the non-personal skeleton — report ID, type, subject spot ID,
  attestation status, timestamps, moderation state — so counts and abuse statistics stay honest
  while the personal content is gone.
- Redaction is the **only** permitted update to a report, it is one-way, and the trigger allows the
  minimizable columns to move only towards NULL.
- Rate-limit counters (§5) carry their own `expires_at` and are purged on the same pass; they
  outlive their window by at most 24 hours.
- A full erase (deleting the row) stays available for a deletion request and is not something the
  public API can trigger.
- **Moderation metadata carries no free text.** `report_moderation` stores `decided_at`,
  `decided_by` (a reviewer handle) and `decision_reason` from a closed vocabulary —
  `confirmed | contradictedBySource | insufficientDetail | duplicateOfExistingReport | outOfScope |
  abuse | unspecified` — enforced by a CHECK constraint. A free-text moderator note would be an
  unbounded, unminimized channel through which a reporter's words could outlive the 90-day ceiling
  on the report itself, so the column does not exist. A moderator who needs to record more decides
  again with a different reason code or opens a repository issue that contains no reporter content.

### 5. Abuse boundary and rate limiting

- `installId` is hashed on arrival: `submitter_hash = SHA-256(pepper ‖ installId)`, where the pepper
  comes from the `REPORT_SUBMITTER_PEPPER` binding. No pepper value is committed to this
  repository; with the binding unset the hash is unpeppered, which is acceptable locally and is
  documented as a pre-launch deployment requirement. The raw `installId` is never stored or logged.
- Limits are per `submitter_hash`: 10 reports per hour and 50 per day, counted in D1 windows
  (`report_rate_windows`). Over a limit the endpoint answers `429` with `Retry-After` and writes
  nothing.
- The request body is capped at 4 KiB; a larger body is rejected with `413` before it is parsed.
- D1 counters are the boundary this architecture (ADR-0003: Workers + D1, no KV or Durable Objects
  configured) can enforce today and are best-effort under concurrency. An edge rate-limit rule in
  front of the Worker, keyed on IP, is a deployment-level pre-launch requirement and is recorded as
  such rather than implemented in application code where it would need to store IPs.

### 6. App Attest: one-time challenge, registration, request-bound assertion

A correct assertion check needs all three of: a one-time, server-issued challenge consumed exactly
once; a `clientDataHash` binding that challenge to the exact report payload; and server-side replay
protection with a strictly increasing per-key counter. A client-supplied challenge satisfies none of
them, so a verdict derived from one would look like evidence of device integrity while being none.
Issue #37 implements all three (`services/api/src/attest/`, migration `0007_app_attest.sql`); the
wire contract is `docs/API.md` "App Attest".

**Two report protocols, one per deployment.** Report request schema 1 is unchanged — it still
accepts no attestation material — and is accepted only where attestation is disabled. Schema 2 is
the attested submission and is accepted only where it is required. `/v1/config` publishes the one
version a deployment accepts (`schemaVersions.report` = `minimumSupportedSchemaVersions.report`) and
`reports.attestation: "none" | "appAttest"`, so a client never infers the protocol from failures and
an old schema-1 client on a required deployment is told to update rather than silently refused.
v1 semantics were not mutated.

**Protocol.**

1. *Challenge.* `POST /v1/app-attest/challenges` issues 32 CSPRNG bytes with an explicit purpose
   (`registration` or `report`, the latter bound to one registered key) and a 5-minute expiry,
   stored in `app_attest_challenges`. The server never accepts a challenge it did not issue.
2. *Registration.* `POST /v1/app-attest/keys` with the key ID, a registration challenge and the
   attestation object. The server runs every step of Apple's "Validating apps that connect to your
   server": the `x5c` chain to the pinned Apple App Attestation Root CA (signatures, validity,
   name linkage, CA flags); nonce = SHA-256(authData ‖ clientDataHash) equals the credential
   certificate's `1.2.840.113635.100.8.2` extension; SHA-256(public key) equals the key ID; RP ID
   hash equals SHA-256(App ID); counter 0; aaguid matches the deployment environment; credentialId
   equals the key ID and the COSE key equals the certified key; and, when the device reports them,
   the launch validation category (production: TestFlight 2 / App Store 4; development: 3) and
   the bundle version, which must be a non-empty string exactly equal to one of the deployment's
   accepted `CFBundleVersion` values (`REPORT_APP_ATTEST_BUNDLE_VERSIONS`). Only then is the key
   stored. Every assertion is held to the same two extension rules against the same allowlist.
   Either extension may be absent — devices and OS versions that do not provide these newer
   extensions send none — and absence is accepted when every other check passes; it is not taken
   as evidence of an older OS or of anything else. The bundle version is checked, never stored.
3. *Report.* The client fetches a report challenge for its key, signs
   `clientDataHash = SHA-256(frame("mannerpath.app-attest.report.v1") ‖ frame(challenge) ‖ frame(keyId) ‖ frame(payload bytes))`
   with `frame(x) = uint32_be(len(x)) ‖ x`, and sends the payload bytes base64-encoded beside the
   assertion. The server hashes the bytes it received — never a re-serialization — so key order,
   whitespace and escaping cannot make client and server disagree. Registration uses the same
   framing with domain `mannerpath.app-attest.registration.v1` over challenge and key ID. Test
   vectors: `contracts/app-attest/client-data-vectors.v1.json`.

**Replay and concurrency.** A challenge is consumed by `UPDATE … WHERE consumed_at IS NULL
RETURNING` *before* any verification, so exactly one request can use it and a failed, replayed or
raced request burns it. Purpose, key and expiry are checked on the consumed row. The counter advance
and the report insert commit in one D1 batch, and a trigger on `app_attest_keys` aborts any update
that does not strictly increase `sign_count`: of two requests carrying the same (or an older)
counter, one commits and the other stores nothing and moves nothing. The counter is never updated
unless the assertion verified.

**What is stored.** Per key: key ID, the P-256 public key, the environment, the last accepted
counter and the registration time. The attestation object, its certificates and its receipt are
verified and discarded (the receipt exists for Apple's fraud-risk metric, which this service does
not use). A report stores only the verdict — `attestation_status = 'verified'` for schema 2,
`'notProvided'` for schema 1 — and no reference to the key, so a report is not linkable to the key
or install that signed it. `'unverified'` stays unused: a rejected assertion stores no report.
Challenges are not personal content; the retention pass deletes them once expired. Registered keys
are kept indefinitely (maintainer decision, Issue #37): they are pseudonymous per-install material
with no link to reports, and deleting them would only force re-registration.

**Ambiguous delivery.** A successful assertion does not prove the response reached the client. If
the final POST is lost after the server committed, the report is stored, the challenge is consumed
and the counter advanced; resending the same request is refused (`challengeInvalid`) and cannot
store a second copy. That refusal says nothing about the earlier request, so the client keeps
treating it as possibly accepted and offers an explicit, duplicate-aware retry (#30/#46) — never an
automatic one.

**Abuse boundary.** Issuing a challenge writes a D1 row for an unauthenticated caller, so
outstanding registration challenges are capped deployment-wide (1000) and report challenges per key
(3), each with a single count-and-insert statement; over the cap is `429`. The per-install report
rate limit (§5) still applies, after verification, so an unverified request cannot spend a budget.
The IP-keyed edge rule (§5) remains a deployment requirement; it is what bounds registration-challenge
flooding.

**Policy parsing fails closed.**

| `REPORT_ATTESTATION` | Behaviour |
|---|---|
| unset / `disabled` | local/test default: schema 1, stored `notProvided`; the App Attest endpoints answer `503` |
| `required` with valid `REPORT_APP_ATTEST_APP_ID`, `REPORT_APP_ATTEST_ENVIRONMENT` and `REPORT_APP_ATTEST_BUNDLE_VERSIONS` | schema 2 only; stored `verified` only after the assertion verified |
| `required` with any of them absent, empty or malformed | `503 attestationUnavailable` everywhere and `reports.available: false` — an unusable allowlist disables reporting, never bundle-version validation |
| anything else (typo, `true`, `enabled`, whitespace, …) | `503 attestationUnavailable` — a typo never silently disables attestation |

The App ID is `<App ID prefix>.<bundle identifier>`, where the App ID prefix is usually the Team
ID; with the environment and the accepted bundle versions it is deployment configuration that is
never committed, and no build number is hard-coded in verification code. No Apple key is committed
either. The trust anchor is the pinned Apple root in code; only
tests can substitute one (through `createApp`), and no binding, header or client field can.

**Still unverified until #35.** Apple publishes a sample attestation (used as a test vector) but no
sample assertion; assertion verification follows Apple's text and is exercised with a synthetic
device. A real signed iPhone must confirm registration and assertion end to end (Issue #35).

### 7. Logging

Report payloads are not logged. The handler emits no log line containing a note, coordinate,
`installId`, `submitter_hash` or attestation material, and validation errors report JSON paths and
issue codes, never submitted values — an error string is a log line waiting to happen. Any future
diagnostic logging of report content requires an amendment to this ADR.

### 8. Inspection

There is no authenticated admin HTTP surface in this slice; adding one without a reviewed auth
model would be a larger risk than the workflow it saves. Moderation runs through
`services/api/src/reports/moderation.ts` and the local-only CLI `npm run local:reports` against
local D1 (`services/api/README.md`). The queue view never returns `submitter_hash`, because a
moderator judges the claim, not the submitter; it does print the claim itself, which is the point
of review and is distinct from the request-path logging §7 forbids. Decisions take a reason code
from the §4 vocabulary — the CLI rejects anything else — and the `queue` command exposes only
`queued` and `discarded`. Reconciliation has its own local commands (`candidates`, `propose`,
`apply`, `withdraw`); they print report IDs, pins and a distinct-submitter count, never a submitter
key.

## Consequences

- The report table is safe to keep, and bounded: personal content has a 90-day ceiling that does
  not depend on anyone doing moderation work.
- Reports cannot improve data on their own. Only a reviewed reconciliation application turns them
  into evidence, and until Issue #124 is resolved that evidence is not published.
- Schema-1 reports are unattested; only local/test deployments accept them. A required deployment
  stores only reports whose App Attest assertion verified. Even then, `verified` means "a genuine
  instance of the app on a genuine device signed these bytes", not that the claim is true:
  moderation still judges the claim.
- Before public launch: set `REPORT_SUBMITTER_PEPPER`, configure `REPORT_APP_ATTEST_APP_ID`,
  `REPORT_APP_ATTEST_ENVIRONMENT` and `REPORT_APP_ATTEST_BUNDLE_VERSIONS` so `required` enforces, verify on a physical device (#35), add the
  edge rate-limit rule, and schedule the retention pass. None of these may be substituted by
  application-level guesses.

## Amendment 2026-09 — community reconciliation (Issue #123)

Implements the missing `queued → evidence` step for **new-spot proposals** (`type = missing`) and
NATIONWIDE_DATA_STRATEGY §8 ("a new community spot requires corroboration across independent
evidence plus moderation"). Code: `services/api/src/pipeline/community-reconciliation.ts`,
`community-adapter.ts`. Migration: `0020_community_reconciliation.sql`. Tests:
`services/api/test/community-reconciliation.test.ts`.

### Decisions

1. **An application is a reviewer's decision, not a computation.** It names explicit report IDs
   and the one report whose pin becomes the spot's location. No coordinate is averaged or
   snapped, and no grouping radius, report count or distance publishes anything automatically.
   `candidates` groups queued reports only with a radius the reviewer passes on each call; there
   is no default. Applications are immutable, move `proposed → applied | withdrawn` once, and are
   never deleted. Evidence links are immutable. A report backs at most one application **ever**,
   so a withdrawn (superseded) decision cannot quietly reuse its reports.
2. **Corroboration = at least two reports from distinct submitters.** This is the literal reading
   of "corroboration across independent evidence", not a tuned threshold. Independence is checked
   by comparing `submitter_hash` at propose time and again by trigger at apply time. The hash is
   never copied, returned or printed.
3. **Every premise is re-checked at apply time, inside the batch.** All reports must still be
   `accepted` and `queued`, unredacted, and inside their minimization window. They must be at
   least two, from distinct submitters. The pin must be one of them, and the release must be this
   application's single-record release. A stale, redacted, discarded or withdrawn premise fails
   before anything is written, and the same checks run as triggers on the first statement of the
   apply batch.
4. **Apply is one D1 batch.** The batch holds the application `→ applied`, every report
   `→ applied`, and the ordinary resolver's writes (source entity, decision, spot, provenance,
   release `→ applied`). Either all of it commits or none of it does. A `userReport` release can
   only become `applied` as the release of an applied application (trigger), so no code path can
   resolve user-derived evidence around the review. Re-applying returns `alreadyApplied`. The only
   write outside the batch is the ingest of the sanitized release: raw evidence that is not
   canonical, is never applied on its own, and is reused byte-identically by a retry.
5. **What survives the 90-day minimization.** The sanitized release record holds exactly:
   application ID, claim (`newSpot`), the adopted latitude/longitude, the sorted evidence report IDs
   and the reconciliation version. It holds no note, `submitter_hash`, `observed_on`, attestation,
   IP, `User-Agent` or `installId`. Report IDs are part of the non-personal skeleton (§4). The
   location is the reviewed spot location, not a person's trajectory. It is copied only at apply
   time, from an unredacted report, so an application that is never applied retains no
   coordinate. The report's `observed_on` is **not** copied, because it would place a person at a
   place on a day beyond 90 days. The release's `observed_on` is therefore NULL, and the spot's
   `lastVerifiedAt` is unknown (ADR-0006).
6. **The source is reviewed in the repository and blocked.** `mannerpath-community-reports`
   (`kind = userReport`) is in `REVIEWED_SOURCES` with `publicationStatus: blocked`, no license and
   no attribution. Neither the API, the terms nor the app grants MannerPath the right to republish
   a submission, so publication and promotion stay closed until Issue #124 settles that.
   Resolution and cross-source review work regardless of that status.

### Not implemented

- Existing-spot report types (`exists`, `moved`, `prohibited`, `hoursChanged`, `accessChanged`,
  `tobaccoTypeChanged`, `other`) as attenuation or hold candidates. They stay `queued`.
- Any rights, license, attribution or promotion support for community evidence (Issue #124).

## Amendment 2026-09-30 — report terms consent and existing-spot effects (Issues #124, #127)

Implements every technical prerequisite of Issue #124 except the legal approval of the terms text,
and connects existing-spot reports (Issue #127). Code: `services/api/src/reports/terms.ts`,
`src/pipeline/community-effects.ts`, `src/pipeline/promotion.ts`. Migration:
`0021_community_publication_readiness.sql`. Tests: `test/community-publication-readiness.test.ts`,
`test/app-attest-api.test.ts`. Draft document: `docs/legal/REPORT_TERMS_DRAFT.md`.

### Decisions

1. **Consent is part of the immutable report.** `reports.accepted_terms_version` records the terms
   version the submitter explicitly agreed to, sent as `acceptedTermsVersion` inside the payload (so
   a schemaVersion 2 assertion signs it). It is not personal: it survives redaction and is frozen by
   the immutability trigger. A report stored without it — every report received before 0021 —
   **never gains consent**: nothing is applied retroactively. Only the deployment's current version
   is accepted (`409 termsVersionOutdated` otherwise), so a stored version always names the document
   the client showed.
2. **Terms versions are reviewed in the repository.** `REPORT_TERMS` lists each version with its
   document path, the SHA-256 of the exact document bytes (pinned by a test) and its publication
   rights: `pending` (draft), `granted` or `revoked`. `report_terms_versions` mirrors it the way
   `sources` mirrors `REVIEWED_SOURCES`; `npm run local:registry` re-applies it. The current version
   `report-terms.2026-09-30.draft` is **pending**: approving the same bytes flips it to `granted` in a
   reviewed PR; approving different text is a new version, and reports consented to the draft keep
   no rights.
3. **Community publication needs a rights basis, not only an approved source.** An application's
   sanitized record now carries the one terms version every evidence report consented to, or nothing
   when the reports do not share one (artifact v2; a v1 record has none). A community spot enters a
   tile only when that version is `granted` **and** the source is approved (trigger
   `tile_snapshot_spots_community_rights` plus `publishTiles`, which reports the rest as
   `rightsNotGranted`). Mixing a consented report with an unconsented one is not a basis. Revoking the
   terms or blocking the source removes the spots at the next publish.
4. **Existing-spot reports lead to exactly one reviewed effect per type** (Issue #127), and none of
   them mutates a canonical value:

   | Report type | Effect | What applying it does |
   | --- | --- | --- |
   | `moved` | `relocationReview` | review candidate for the ADR-0009 relocation workflow |
   | `prohibited` | `publicationHoldReview` | review candidate; a separate hold step may withhold the spot |
   | `hoursChanged` | `hoursReview` | review candidate (hours attenuation stays source-driven, Issue #42) |
   | `accessChanged` | `accessReview` | review candidate |
   | `tobaccoTypeChanged` | `tobaccoTypeReview` | review candidate |
   | `exists` | `existenceVerification` | verification candidate; `lastVerifiedAt` is not touched |
   | `other` | none | no application can be made; it is read in the moderation queue only |

   The chain is `accepted → queued → immutable effect application (one type, one spot, explicit
   reports) → applied`, re-checked inside the apply batch like 0020. A report backs at most one
   application of either kind, ever.
5. **The one public-facing effect is a fail-closed hold.** `holdCommunityEffect` withholds the spot
   of an applied `publicationHoldReview` (a `community_publication_holds` row; no canonical column
   changes, the spot is unpublished first). The database refuses it unless the community rights hold:
   the source approved, every evidence report consented to one granted terms version, at least two
   reports from distinct submitters, all unredacted and inside their minimization window. While
   Issue #124 is open the step returns `blocked` with its reasons and writes nothing. A hold is
   lifted once, by a reviewed lift; a lifted hold is not re-applied.
6. **Moderation stays local and counts-only where it summarizes.** `npm run local:reports` gains
   `effects`, `effect-propose|apply|hold|lift|withdraw` and `summary`. The effects view and the
   summary show report counts, independent submitters, redacted/stale counts, rights blockers and
   the target effect; no note, pin, date or submitter key. There is still no admin HTTP surface.

### Still open (legal/maintainer only)

- Approval of the terms text (`docs/legal/REPORT_TERMS_DRAFT.md`) and its `REPORT_TERMS` entry.
- The community source's license and attribution text in `docs/SOURCES.md` and `COMMUNITY_REGISTRY`.
- Whether `lastVerifiedAt` of community spots stays unknown (Issue #124 item 3).
