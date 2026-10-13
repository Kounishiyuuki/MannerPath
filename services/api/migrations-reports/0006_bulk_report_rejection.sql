-- REPORTS_DB only. Bulk moderation commits header, immutable targets and completion in one D1 batch.
-- No report content, submitter key, hash or secret is copied to the audit.
CREATE TABLE report_bulk_store_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  store_id TEXT NOT NULL UNIQUE CHECK (length(store_id) = 32 AND store_id NOT GLOB '*[^0-9a-f]*')
);
INSERT INTO report_bulk_store_identity VALUES (1, lower(hex(randomblob(16))));
CREATE TRIGGER report_bulk_store_identity_no_update BEFORE UPDATE ON report_bulk_store_identity BEGIN SELECT RAISE(ABORT, 'bulk identity immutable'); END;
CREATE TRIGGER report_bulk_store_identity_no_delete BEFORE DELETE ON report_bulk_store_identity BEGIN SELECT RAISE(ABORT, 'bulk identity immutable'); END;
CREATE TABLE report_bulk_rejections (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK (length(operation_id) = 64 AND operation_id NOT GLOB '*[^0-9a-f]*'),
  reason TEXT NOT NULL CHECK (reason IN ('abuse', 'outOfScope', 'contradictedBySource', 'insufficientDetail')),
  decided_by TEXT NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 64 AND decided_by NOT GLOB '*[^a-zA-Z0-9_-]*'),
  decided_at TEXT NOT NULL,
  target_count INTEGER NOT NULL CHECK (target_count BETWEEN 1 AND 40),
  selector_kind TEXT NOT NULL CHECK (selector_kind IN ('reportIds', 'period', 'key'))
);
CREATE TABLE report_bulk_rejection_targets (
  operation_id TEXT NOT NULL REFERENCES report_bulk_rejections(operation_id),
  report_id TEXT NOT NULL CHECK (length(report_id) = 29 AND report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*'),
  received_at TEXT NOT NULL,
  previous_state TEXT NOT NULL CHECK (previous_state IN ('pending', 'needsInfo', 'accepted')),
  previous_updated_at TEXT NOT NULL,
  previous_decided_at TEXT,
  previous_decided_by TEXT CHECK (previous_decided_by IS NULL OR (length(previous_decided_by) BETWEEN 1 AND 64 AND previous_decided_by NOT GLOB '*[^a-zA-Z0-9_-]*')),
  previous_decision_reason TEXT CHECK (previous_decision_reason IS NULL OR previous_decision_reason IN (
    'confirmed', 'contradictedBySource', 'insufficientDetail', 'duplicateOfExistingReport', 'outOfScope', 'abuse', 'unspecified')),
  PRIMARY KEY (operation_id, report_id)
);
CREATE TABLE report_bulk_rejection_completions (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES report_bulk_rejections(operation_id),
  completed_at TEXT NOT NULL
);
CREATE TRIGGER report_bulk_targets_check BEFORE INSERT ON report_bulk_rejection_targets BEGIN
  SELECT RAISE(ABORT, 'bulk target stale') WHERE NOT EXISTS (
    SELECT 1 FROM reports r JOIN report_moderation m ON r.report_id = m.report_id
    WHERE r.report_id = NEW.report_id AND r.received_at = NEW.received_at
      AND m.state = NEW.previous_state AND m.updated_at = NEW.previous_updated_at
      AND m.decided_at IS NEW.previous_decided_at AND m.decided_by IS NEW.previous_decided_by
      AND m.decision_reason IS NEW.previous_decision_reason AND m.reconciliation_state = 'notQueued'
  );
  SELECT RAISE(ABORT, 'bulk operation complete') WHERE EXISTS (SELECT 1 FROM report_bulk_rejection_completions WHERE operation_id = NEW.operation_id);
END;
CREATE TRIGGER report_bulk_targets_apply AFTER INSERT ON report_bulk_rejection_targets BEGIN
  UPDATE report_moderation SET state = 'rejected',
    decided_at = (SELECT decided_at FROM report_bulk_rejections WHERE operation_id = NEW.operation_id),
    updated_at = (SELECT decided_at FROM report_bulk_rejections WHERE operation_id = NEW.operation_id),
    decided_by = (SELECT decided_by FROM report_bulk_rejections WHERE operation_id = NEW.operation_id),
    decision_reason = (SELECT reason FROM report_bulk_rejections WHERE operation_id = NEW.operation_id)
    WHERE report_id = NEW.report_id;
END;
CREATE TRIGGER report_bulk_completion_check BEFORE INSERT ON report_bulk_rejection_completions BEGIN
  SELECT RAISE(ABORT, 'bulk incomplete') WHERE NOT EXISTS (
    SELECT 1 FROM report_bulk_rejections o WHERE o.operation_id = NEW.operation_id AND o.decided_at = NEW.completed_at
      AND (SELECT count(*) FROM report_bulk_rejection_targets t WHERE t.operation_id = o.operation_id) = o.target_count
      AND NOT EXISTS (
        SELECT 1 FROM report_bulk_rejection_targets t LEFT JOIN report_moderation m ON m.report_id = t.report_id
        WHERE t.operation_id = o.operation_id AND (m.report_id IS NULL OR m.state <> 'rejected'
          OR m.reconciliation_state <> 'notQueued' OR m.updated_at <> o.decided_at
          OR m.decided_at IS NOT o.decided_at OR m.decided_by IS NOT o.decided_by OR m.decision_reason IS NOT o.reason)
      )
  );
END;
CREATE TRIGGER report_bulk_rejections_no_update BEFORE UPDATE ON report_bulk_rejections BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
CREATE TRIGGER report_bulk_rejections_no_delete BEFORE DELETE ON report_bulk_rejections BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
CREATE TRIGGER report_bulk_targets_no_update BEFORE UPDATE ON report_bulk_rejection_targets BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
CREATE TRIGGER report_bulk_targets_no_delete BEFORE DELETE ON report_bulk_rejection_targets BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
CREATE TRIGGER report_bulk_completions_no_update BEFORE UPDATE ON report_bulk_rejection_completions BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
CREATE TRIGGER report_bulk_completions_no_delete BEFORE DELETE ON report_bulk_rejection_completions BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
CREATE INDEX report_bulk_targets_report ON report_bulk_rejection_targets (report_id, operation_id);
CREATE INDEX reports_bulk_submitter_received ON reports (submitter_hash, received_at, report_id) WHERE submitter_hash IS NOT NULL;
-- REPLACE must not bypass append-only history when recursive_triggers is disabled (SQLite default).
CREATE TRIGGER report_bulk_identity_no_replace BEFORE INSERT ON report_bulk_store_identity
WHEN EXISTS (SELECT 1 FROM report_bulk_store_identity WHERE singleton = NEW.singleton)
BEGIN SELECT RAISE(ABORT, 'bulk identity immutable'); END;
CREATE TRIGGER report_bulk_rejections_no_replace BEFORE INSERT ON report_bulk_rejections
WHEN EXISTS (SELECT 1 FROM report_bulk_rejections WHERE operation_id = NEW.operation_id)
BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
CREATE TRIGGER report_bulk_targets_no_replace BEFORE INSERT ON report_bulk_rejection_targets
WHEN EXISTS (SELECT 1 FROM report_bulk_rejection_targets WHERE operation_id = NEW.operation_id AND report_id = NEW.report_id)
BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
CREATE TRIGGER report_bulk_completions_no_replace BEFORE INSERT ON report_bulk_rejection_completions
WHEN EXISTS (SELECT 1 FROM report_bulk_rejection_completions WHERE operation_id = NEW.operation_id)
BEGIN SELECT RAISE(ABORT, 'bulk audit immutable'); END;
