-- Report idempotency receipts and the hard report budget (ADR-0007 §5, docs/API.md "POST /reports").
--
-- A receipt records that one logical submission (one client draft) produced one report. Its key is a digest of the
-- client's 256-bit random idempotency key; the raw key is never stored, and neither an App Attest key, a submitter
-- hash nor an installId takes part in it, so a pepper rotation or a new App Attest key cannot turn a retry into a
-- second report, and the receipt adds no device linkage. request_sha256 is the canonical hash of the validated
-- report; retention clears it together with the report's personal content (retired_at), after which the receipt only
-- refuses the key. A receipt is never deleted, and its report cannot be deleted while it exists.

CREATE TABLE report_idempotency (
  idempotency_digest TEXT PRIMARY KEY CHECK (length(idempotency_digest) = 64 AND idempotency_digest NOT GLOB '*[^0-9a-f]*'),
  report_id          TEXT NOT NULL UNIQUE REFERENCES reports (report_id) ON DELETE RESTRICT,
  request_sha256     TEXT CHECK (request_sha256 IS NULL OR (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*')),
  created_at         TEXT NOT NULL,
  retired_at         TEXT,
  CHECK ((retired_at IS NULL) = (request_sha256 IS NOT NULL)),
  CHECK (retired_at IS NULL OR retired_at >= created_at)
);

CREATE TRIGGER report_idempotency_born_active
BEFORE INSERT ON report_idempotency
WHEN NEW.retired_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'report_idempotency: a receipt is created active');
END;

CREATE TRIGGER report_idempotency_retire_only
BEFORE UPDATE ON report_idempotency
WHEN NEW.idempotency_digest IS NOT OLD.idempotency_digest
  OR NEW.report_id IS NOT OLD.report_id
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.retired_at IS NOT NULL
  OR NEW.retired_at IS NULL
  OR NEW.request_sha256 IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'report_idempotency: a receipt changes only by its one retirement');
END;

CREATE TRIGGER report_idempotency_no_delete
BEFORE DELETE ON report_idempotency
BEGIN
  SELECT RAISE(ABORT, 'report_idempotency: a receipt is never deleted');
END;

-- The report budget, enforced inside the report's own write: the counter increment shares the batch with the report
-- insert, so a debit that would exceed a window aborts the whole batch and no report, receipt or debit commits.
-- The limits must equal REPORT_RATE_LIMITS in src/reports/rate-limit.ts (test/report-idempotency.test.ts checks).
-- The trigger bodies use plain boolean conditions only: Wrangler's remote migration path mis-split 0003 at a
-- conditional expression inside a trigger (REPORTS_MIGRATION_RECOVERY.md, workers-sdk #4727).
CREATE TRIGGER report_rate_windows_budget_insert
BEFORE INSERT ON report_rate_windows
WHEN (NEW.window_kind = 'hour' AND NEW.report_count > 10) OR (NEW.window_kind = 'day' AND NEW.report_count > 50)
BEGIN
  SELECT RAISE(ABORT, 'report_rate_windows: report budget exhausted');
END;

CREATE TRIGGER report_rate_windows_budget_update
BEFORE UPDATE OF report_count ON report_rate_windows
WHEN (NEW.window_kind = 'hour' AND NEW.report_count > 10) OR (NEW.window_kind = 'day' AND NEW.report_count > 50)
BEGIN
  SELECT RAISE(ABORT, 'report_rate_windows: report budget exhausted');
END;
