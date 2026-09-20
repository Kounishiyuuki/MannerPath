# ADR-0007 — User report privacy, retention and moderation

Status: Accepted (2026-09, Issue #29). Amended 2026-09 by the PR #36 review: App Attest deferred
(§6), moderation notes replaced by a bounded reason vocabulary (§4), reconciliation transitions
narrowed to the ones this slice can honestly make (§2).

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
| ~~`attestation`~~ | — | **not accepted in v1**; App Attest is deferred (§6) |

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

### 6. App Attest / DeviceCheck: deferred, and fail-closed

App Attest is **not implemented in v1, and v1 does not pretend otherwise.** A correct assertion
check needs all three of:

1. a one-time, server-issued challenge, stored and consumed exactly once;
2. a `clientDataHash` binding that challenge to the exact report payload being submitted;
3. server-side replay protection, including the strictly increasing per-key assertion counter.

A client-supplied challenge satisfies none of them — it is replayable and bound to nothing — so a
verdict derived from it would be worse than no verdict: it would look like evidence of device
integrity. Therefore:

- the v1 request schema accepts **no attestation material**; sending any is a `400 invalidReport`;
- every report is stored with `attestation_status = 'notProvided'`. The `verified`/`unverified`
  values stay in the column for the protocol slice that will set them;
- no `AttestationVerifier` interface is exposed, because a verifier without §6.1–§6.3 cannot be
  correct, and a plausible-looking hook invites exactly that mistake;
- the follow-up work is Issue #37.

`REPORT_ATTESTATION` parsing is exhaustive and fails closed:

| Value | Behaviour |
|---|---|
| unset | disabled — the documented local and test default; reports are accepted |
| `disabled` | disabled — same, stated explicitly |
| `required` | `503 attestationUnavailable`; no report is stored until Issue #37 lands |
| anything else (typo, `true`, `enabled`, whitespace, …) | `503 attestationUnavailable` — a misconfiguration never silently disables attestation |

The check runs before the request body is read, so an enforcing or misspelled policy cannot store
a single report. No Apple private key, team ID or bundle secret is committed to this repository at
any point; they are deployment configuration for Issue #37.

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
- Reports are unattested in v1. That is a known, stated gap: the abuse boundary is the hashed
  submitter key plus rate limiting, and moderation assumes nothing about device integrity.
- Before public launch: set `REPORT_SUBMITTER_PEPPER`, land Issue #37 and then turn on
  `REPORT_ATTESTATION=required`, add the edge rate-limit rule, and schedule the retention pass.
  None of these may be substituted by application-level guesses.
