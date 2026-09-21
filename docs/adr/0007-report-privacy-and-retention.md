# ADR-0007 — User report privacy, retention and moderation

Status: Accepted (2026-09, Issue #29). Amended 2026-09 by the PR #36 review: App Attest deferred
(§6), moderation notes replaced by a bounded reason vocabulary (§4), reconciliation transitions
narrowed to the ones this slice can honestly make (§2). Amended 2026-09 by Issue #37: App Attest
implemented as a server-issued challenge / key registration / request-bound assertion protocol
(§6), report request schema 2.

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
  | anything | `applied` | **no** — nothing in this slice applies a report |
  | `queued` / `discarded` / `applied` | `notQueued` | **no** — backward |
  | `discarded` / `applied` | anything | **no** — terminal |

  `applied` stays in the column's vocabulary for the reconciliation slice that will set it, but it
  is unreachable: a database trigger rejects entering it, a row is born `notQueued`, and the
  moderation module's type does not offer it. Neither the module nor the local CLI can claim that
  reconciliation was applied while no reconciliation exists.

Accepting a report records a human judgement that the claim looks true. It does **not** make the
report canonical evidence and does not change any published tile. Turning an accepted report into
evidence is a separate, deliberate reconciliation step: it registers a `userReport` source through
the reviewed source registry and goes through the ordinary ingest → resolve → publish path with
the ADR-0006 publication invariant intact. That step is **not** part of this slice; until it
exists, `reconciliation_state` stays `notQueued`/`queued` and nothing reaches canonical data.

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
   bundle version. Only then is the key stored.
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
| `required` with valid `REPORT_APP_ATTEST_APP_ID` and `REPORT_APP_ATTEST_ENVIRONMENT` | schema 2 only; stored `verified` only after the assertion verified |
| `required` without them, or malformed | `503 attestationUnavailable` everywhere — nothing to verify against |
| anything else (typo, `true`, `enabled`, whitespace, …) | `503 attestationUnavailable` — a typo never silently disables attestation |

The App ID carries the Team ID and, with the environment, is deployment configuration that is
never committed; neither is any Apple key. The trust anchor is the pinned Apple root in code; only
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
from the §4 vocabulary — the CLI rejects anything else — and the reconciliation command exposes
only `queued` and `discarded`.

## Consequences

- The report table is safe to keep, and bounded: personal content has a 90-day ceiling that does
  not depend on anyone doing moderation work.
- Reports cannot improve data on their own. Until the reconciliation step exists, their value is
  a reviewed queue, and that is deliberate.
- Schema-1 reports are unattested; only local/test deployments accept them. A required deployment
  stores only reports whose App Attest assertion verified. Even then, `verified` means "a genuine
  instance of the app on a genuine device signed these bytes", not that the claim is true:
  moderation still judges the claim.
- Before public launch: set `REPORT_SUBMITTER_PEPPER`, configure `REPORT_APP_ATTEST_APP_ID` and
  `REPORT_APP_ATTEST_ENVIRONMENT` so `required` enforces, verify on a physical device (#35), add the
  edge rate-limit rule, and schedule the retention pass. None of these may be substituted by
  application-level guesses.
