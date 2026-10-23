-- 0007 is reserved for the independently developed private R2 integration.
-- Bounded moderation metadata only: no report text, pins, submitter identity or object keys.
CREATE TABLE admin_review_audit (
 operation_id TEXT PRIMARY KEY,
 report_id TEXT NOT NULL,
 photo_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('accepted','needsInfo','rejected','duplicate','approved')),
 reason TEXT NOT NULL CHECK(reason IN ('confirmed','contradictedBySource','insufficientDetail','duplicateOfExistingReport','outOfScope','abuse','unspecified','usableEvidence','privacyRisk','unrelated','unsafeContent')),
 decided_by TEXT NOT NULL CHECK(length(decided_by) BETWEEN 1 AND 64 AND decided_by NOT GLOB '*[^a-zA-Z0-9._-]*'),
 decided_at TEXT NOT NULL,
 privacy_checked INTEGER NOT NULL CHECK(privacy_checked IN (0,1)),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64)
);
CREATE INDEX admin_review_audit_report ON admin_review_audit(report_id,decided_at,operation_id);
-- BEFORE INSERT also blocks INSERT OR REPLACE when recursive_triggers is disabled.
CREATE TRIGGER admin_review_audit_no_replace BEFORE INSERT ON admin_review_audit
WHEN EXISTS(SELECT 1 FROM admin_review_audit WHERE operation_id=NEW.operation_id) BEGIN
 SELECT RAISE(ABORT,'admin audit: immutable');
END;
CREATE TRIGGER admin_review_audit_no_update BEFORE UPDATE ON admin_review_audit BEGIN
 SELECT RAISE(ABORT,'admin audit: immutable');
END;
CREATE TRIGGER admin_review_audit_no_delete BEFORE DELETE ON admin_review_audit BEGIN
 SELECT RAISE(ABORT,'admin audit: immutable');
END;
