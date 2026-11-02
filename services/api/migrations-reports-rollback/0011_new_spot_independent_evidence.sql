-- ROLLBACK of REPORTS_DB 0011 (docs/release/V1_PHOTO_FREE_NEW_SPOT.md §8). NOT a migration: it lives outside
-- migrations-reports/ so `wrangler d1 migrations apply` never runs it. Run only with the operator's approval:
--   wrangler d1 execute <REPORTS_DB> --remote --file migrations-reports-rollback/0011_new_spot_independent_evidence.sql
-- It restores the photo-only export gate of 0009/0010 (statement for statement as those files wrote it) and drops
-- the 0011 gate, so a new place again needs a viewable approved photo. It keeps new_spot_evidence_checks and its
-- triggers: those rows are the immutable record of operator checks, and with this gate restored they back nothing.
-- d1_migrations still lists 0011, so a later re-enable is a new migration, never a re-run of 0011.
DROP TRIGGER IF EXISTS report_reviews_new_spot_evidence;
CREATE TRIGGER report_reviews_new_spot_photo_evidence
BEFORE UPDATE OF state ON report_reviews
WHEN NEW.state = 'exported' AND NEW.review_kind = 'newSpot' AND EXISTS (
  SELECT 1 FROM report_review_evidence e
  JOIN reports r ON r.report_id = e.report_id
  -- Redacted or expired reports are refused by report_reviews_export_premised; this trigger adds only the photo premise.
  WHERE e.review_id = NEW.review_id AND r.report_type = 'missing' AND r.redacted_at IS NULL AND r.minimize_after > NEW.exported_at
    AND NOT EXISTS (SELECT 1 FROM community_evidence_photos p
                    WHERE p.report_id = r.report_id AND p.lifecycle = 'ready'
                      AND p.moderation_status = 'approved' AND p.delete_after > NEW.exported_at))
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: a new-spot report has no approved evidence photo');
END;
CREATE TRIGGER report_reviews_new_spot_photo_viewable
BEFORE UPDATE OF state ON report_reviews
WHEN NEW.state = 'exported' AND NEW.review_kind = 'newSpot' AND EXISTS (
  SELECT 1 FROM report_review_evidence e
  JOIN reports r ON r.report_id = e.report_id
  WHERE e.review_id = NEW.review_id AND r.report_type = 'missing' AND r.redacted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM community_evidence_photos p
                    WHERE p.report_id = r.report_id AND p.lifecycle = 'ready' AND p.moderation_status = 'approved'
                      AND julianday(p.delete_after) > julianday(NEW.exported_at, '+1 day')
                      AND NOT EXISTS (SELECT 1 FROM community_photo_deletions d WHERE d.storage_key = p.storage_key)))
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: a new-spot report has no viewable approved evidence photo');
END;
