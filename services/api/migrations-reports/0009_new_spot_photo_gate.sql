-- v1.0 publication gate (ADR-0016 "New-spot photo gate"): a new-spot review cannot be exported, so no evidence artifact
-- can carry a new place, unless every `missing` report it rests on has a ready, moderator-approved evidence photo
-- inside that photo's deadline. Re-checked inside the export batch, like report_reviews_export_premised; the
-- application code checks the same premise first (src/reports/review.ts). Photos themselves never leave REPORTS_DB.
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
