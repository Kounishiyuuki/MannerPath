-- User verification/correction reports (ADR-0007, Issue #29). Reports are an append-only proposal
-- layer that lives beside canonical data and never writes to it: nothing here references spots,
-- source_records or the published tables, and nothing in the evidence layers references a report.
-- Turning an accepted report into evidence is a separate reconciliation step (ADR-0007 §2) that
-- goes through the ordinary source/release/record path, not through these tables.

CREATE TABLE reports (
  report_id            TEXT PRIMARY KEY CHECK (length(report_id) = 29 AND report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*'),
  schema_version       INTEGER NOT NULL CHECK (schema_version >= 1),
  report_type          TEXT NOT NULL CHECK (report_type IN (
                         'exists', 'missing', 'moved', 'hoursChanged',
                         'tobaccoTypeChanged', 'accessChanged', 'prohibited', 'other')),
  -- The spot the claim is about, as the client stated it. Deliberately NOT a foreign key: an
  -- unknown or unpublished ID is stored unchanged so the report layer cannot be used to probe
  -- which canonical spots exist, and so a report never depends on canonical rows (ADR-0007 §1).
  subject_spot_id      TEXT CHECK (subject_spot_id IS NULL OR (length(subject_spot_id) = 29 AND subject_spot_id GLOB 'sp_[0-9A-HJKMNP-TV-Z]*')),
  -- The proposed position of the reported spot, rounded to 5 decimals (~1 m) by the API. It is the
  -- map pin being proposed, never the device's own position, and it exists only for the two report
  -- types that are about a location. One coordinate per report; no trajectory, ever (ADR-0007 §3).
  proposed_latitude    REAL CHECK (proposed_latitude IS NULL OR proposed_latitude BETWEEN -90 AND 90),
  proposed_longitude   REAL CHECK (proposed_longitude IS NULL OR proposed_longitude BETWEEN -180 AND 180),
  -- Day precision only: a report must not place a person somewhere at an hour.
  observed_on          TEXT CHECK (observed_on IS NULL OR observed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  note                 TEXT CHECK (note IS NULL OR length(note) <= 280),
  -- SHA-256(pepper || installId). The raw install identifier is never stored (ADR-0007 §5).
  submitter_hash       TEXT CHECK (submitter_hash IS NULL OR (length(submitter_hash) = 64 AND submitter_hash NOT GLOB '*[^0-9a-f]*')),
  -- App Attest is deferred (ADR-0007 §6): v1 accepts no attestation material, so this is always
  -- 'notProvided'. The other values exist for the protocol slice that will set them; only a
  -- verdict is ever stored here, never a key ID, assertion or challenge.
  attestation_status   TEXT NOT NULL CHECK (attestation_status IN ('notProvided', 'verified', 'unverified')),
  received_at          TEXT NOT NULL,
  -- Personal content is minimized after this time whatever the moderation state (ADR-0007 §4).
  minimize_after       TEXT NOT NULL,
  redacted_at          TEXT,
  CHECK (minimize_after > received_at),
  CHECK ((proposed_latitude IS NULL) = (proposed_longitude IS NULL)),
  -- A location proposal is meaningful only for these two types; the API rejects it for the rest.
  CHECK (proposed_latitude IS NULL OR report_type IN ('missing', 'moved')),
  -- 'missing' proposes a spot that has no canonical ID yet; every other type names one.
  CHECK ((subject_spot_id IS NULL) = (report_type = 'missing')),
  -- Redaction clears every minimizable column together, so a half-redacted row cannot exist.
  CHECK (redacted_at IS NULL OR (note IS NULL AND proposed_latitude IS NULL AND observed_on IS NULL AND submitter_hash IS NULL))
);

CREATE INDEX reports_subject_spot ON reports (subject_spot_id) WHERE subject_spot_id IS NOT NULL;
CREATE INDEX reports_minimize_due ON reports (minimize_after) WHERE redacted_at IS NULL;

-- A stored report is an immutable proposal. The single permitted update is redaction: the
-- minimizable columns may only move towards NULL, and redacted_at must be set by the same
-- statement. Everything else -- identity, type, subject, attestation verdict, timestamps -- is
-- frozen, so a report can never be rewritten into a different claim after the fact.
CREATE TRIGGER reports_only_redaction_updates
BEFORE UPDATE ON reports
WHEN NEW.report_id IS NOT OLD.report_id
  OR NEW.schema_version IS NOT OLD.schema_version
  OR NEW.report_type IS NOT OLD.report_type
  OR NEW.subject_spot_id IS NOT OLD.subject_spot_id
  OR NEW.attestation_status IS NOT OLD.attestation_status
  OR NEW.received_at IS NOT OLD.received_at
  OR NEW.minimize_after IS NOT OLD.minimize_after
  OR NEW.redacted_at IS NULL
  OR OLD.redacted_at IS NOT NULL
  OR (NEW.note IS NOT OLD.note AND NEW.note IS NOT NULL)
  OR (NEW.proposed_latitude IS NOT OLD.proposed_latitude AND NEW.proposed_latitude IS NOT NULL)
  OR (NEW.proposed_longitude IS NOT OLD.proposed_longitude AND NEW.proposed_longitude IS NOT NULL)
  OR (NEW.observed_on IS NOT OLD.observed_on AND NEW.observed_on IS NOT NULL)
  OR (NEW.submitter_hash IS NOT OLD.submitter_hash AND NEW.submitter_hash IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'reports are immutable proposals; the only permitted update is redaction to NULL');
END;

-- Moderation is explicit state about a report, kept out of the immutable event itself.
-- reconciliation_state is the second gate: accepting a claim is a judgement, not evidence.
CREATE TABLE report_moderation (
  report_id            TEXT PRIMARY KEY REFERENCES reports (report_id) ON DELETE CASCADE,
  state                TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'duplicate', 'needsInfo')),
  -- Only an accepted report may ever be queued for reconciliation, and queuing is still not
  -- publication: the reconciliation step registers a userReport source and re-enters the ordinary
  -- ingest -> resolve -> publish path with the ADR-0006 invariant intact.
  reconciliation_state TEXT NOT NULL DEFAULT 'notQueued' CHECK (reconciliation_state IN ('notQueued', 'queued', 'applied', 'discarded')),
  decided_at           TEXT,
  -- Who decided. A reviewer handle, never an end user.
  decided_by           TEXT,
  -- A bounded, non-personal vocabulary instead of free text: a moderator note would be an
  -- unbounded channel for reporter content that outlives the 90-day ceiling on the report
  -- itself (ADR-0007 §4). Nothing a reporter submits can be copied into this column.
  decision_reason      TEXT CHECK (decision_reason IS NULL OR decision_reason IN (
                         'confirmed', 'contradictedBySource', 'insufficientDetail',
                         'duplicateOfExistingReport', 'outOfScope', 'abuse', 'unspecified')),
  updated_at           TEXT NOT NULL,
  CHECK ((state = 'pending') = (decided_at IS NULL)),
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK ((state = 'pending') = (decision_reason IS NULL)),
  CHECK (reconciliation_state = 'notQueued' OR state = 'accepted')
);

CREATE INDEX report_moderation_queue ON report_moderation (state, updated_at);

CREATE TRIGGER report_moderation_no_reopen
BEFORE UPDATE ON report_moderation
WHEN NEW.state = 'pending' AND OLD.state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: a decided report cannot return to pending');
END;

-- Reconciliation state machine (ADR-0007 §2). This slice has no reconciliation implementation, so
-- the only transitions that exist are the ones it can honestly make: notQueued -> queued,
-- notQueued -> discarded and queued -> discarded. Forward skips into 'applied', every backward
-- step and every move out of a terminal state are rejected here, in the database, so no caller --
-- module, CLI or future code path -- can claim work that was not done.
-- A row is always born notQueued, so the transition trigger below sees every later move.
CREATE TRIGGER report_moderation_reconciliation_starts_unqueued
BEFORE INSERT ON report_moderation
WHEN NEW.reconciliation_state <> 'notQueued'
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: reconciliation starts at notQueued');
END;

CREATE TRIGGER report_moderation_reconciliation_transitions
BEFORE UPDATE OF reconciliation_state ON report_moderation
WHEN NEW.reconciliation_state <> OLD.reconciliation_state
  AND NOT (OLD.reconciliation_state = 'notQueued' AND NEW.reconciliation_state IN ('queued', 'discarded'))
  AND NOT (OLD.reconciliation_state = 'queued' AND NEW.reconciliation_state = 'discarded')
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: illegal reconciliation transition (allowed: notQueued->queued, notQueued->discarded, queued->discarded; applied is not implemented in this slice)');
END;

CREATE TRIGGER report_moderation_report_fixed
BEFORE UPDATE OF report_id ON report_moderation
WHEN NEW.report_id IS NOT OLD.report_id
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: a decision belongs to one report');
END;

-- Rate-limit counters keyed on the hashed submitter only (ADR-0007 §5). No IP, no device ID.
-- Rows carry their own expiry and are purged by the retention pass.
CREATE TABLE report_rate_windows (
  submitter_hash       TEXT NOT NULL CHECK (length(submitter_hash) = 64 AND submitter_hash NOT GLOB '*[^0-9a-f]*'),
  window_kind          TEXT NOT NULL CHECK (window_kind IN ('hour', 'day')),
  window_start         TEXT NOT NULL,
  report_count         INTEGER NOT NULL CHECK (report_count >= 0),
  expires_at           TEXT NOT NULL,
  PRIMARY KEY (submitter_hash, window_kind, window_start)
);

CREATE INDEX report_rate_windows_expiry ON report_rate_windows (expires_at);
