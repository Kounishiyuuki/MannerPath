-- REPORTS_DB owns private report read paths. DATA_DB migrations never create these indexes.
-- Oldest-first pages avoid repeated temporary sorts; local proposal lookup narrows latitude first.
CREATE INDEX reports_received_page ON reports(received_at, report_id);
CREATE INDEX reports_proposal_spatial ON reports(proposed_latitude, proposed_longitude)
  WHERE report_type = 'missing' AND redacted_at IS NULL;
CREATE INDEX reports_subject_evidence ON reports(subject_spot_id, report_type, received_at, report_id)
  WHERE subject_spot_id IS NOT NULL;

-- A queue cursor never silently traverses a changed priority order. Mutation invalidates it explicitly.
CREATE TABLE moderation_queue_revision (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL);
INSERT INTO moderation_queue_revision VALUES (1, 0);
CREATE TRIGGER moderation_queue_reports_update AFTER UPDATE ON reports
BEGIN UPDATE moderation_queue_revision SET revision = revision + 1 WHERE singleton = 1; END;
CREATE TRIGGER moderation_queue_decision_update AFTER UPDATE ON report_moderation
BEGIN UPDATE moderation_queue_revision SET revision = revision + 1 WHERE singleton = 1; END;

CREATE TRIGGER moderation_queue_reports_delete AFTER DELETE ON reports
BEGIN UPDATE moderation_queue_revision SET revision = revision + 1 WHERE singleton = 1; END;
CREATE TRIGGER moderation_queue_decision_delete AFTER DELETE ON report_moderation
BEGIN UPDATE moderation_queue_revision SET revision = revision + 1 WHERE singleton = 1; END;
