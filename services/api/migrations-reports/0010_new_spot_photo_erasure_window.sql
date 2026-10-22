-- v1.0 publication gate, P0 follow-up to 0009 (ADR-0016 "New-spot photo gate"). R2 erasure of a photo may begin
-- PHOTO_ERASURE_LEAD_MS (24 h) before its delete_after, and a key in community_photo_deletions is already on its way
-- out; neither is evidence an operator can still view. 0009 compared delete_after only, so it is kept and this stricter
-- trigger is added beside it (additive: an already applied 0009 is never edited). julianday() compares instants, so a
-- differently spelled timestamp cannot pass a string comparison; an unparsable one yields NULL and is refused.
-- The application checks the same premise first (newSpotPhotoGate in src/reports/photos.ts).
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
