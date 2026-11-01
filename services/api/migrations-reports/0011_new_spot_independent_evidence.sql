-- v1.0 new places without photos (scope decision 2026-11-02: photos on Workers Free were NO-GO; photos 1–3 return in
-- v1.1). A `missing` report is words and a pin from one person, so it may back a new place only when an operator has
-- checked the place independently and recorded how: an official source page (`officialSource`, its https URL) or a
-- visit in person (`siteVisit`). An approved, still viewable photo (0010) remains the other way to open the gate, so
-- v1.1 photos need no migration of this table.
--
-- Bounded operator metadata only: no report text, pin, submitter identity or free text. Immutable like
-- admin_review_audit (0008): a wrong record is answered by rejecting the report, never by editing evidence.
CREATE TABLE new_spot_evidence_checks (
 operation_id TEXT PRIMARY KEY,
 report_id TEXT NOT NULL REFERENCES reports(report_id),
 basis TEXT NOT NULL CHECK(basis IN ('officialSource','siteVisit')),
 source_url TEXT CHECK(source_url IS NULL OR (length(source_url) BETWEEN 12 AND 300 AND source_url GLOB 'https://?*'
   AND source_url NOT GLOB '*[^!-~]*' AND source_url NOT GLOB 'https://*@*' AND source_url NOT GLOB '*#*')),
 checked_on TEXT NOT NULL CHECK(length(checked_on)=10 AND date(checked_on) IS checked_on),
 recorded_by TEXT NOT NULL CHECK(length(recorded_by) BETWEEN 1 AND 64 AND recorded_by NOT GLOB '*[^a-zA-Z0-9._-]*'),
 recorded_at TEXT NOT NULL,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 CHECK((basis='officialSource')=(source_url IS NOT NULL))
);
CREATE INDEX new_spot_evidence_checks_report ON new_spot_evidence_checks(report_id,recorded_at,operation_id);

-- Only for a live new-spot proposal still open for review, and only for a check made between the report's arrival and
-- the recording: evidence older than the report did not check this report's claim. checked_on is a Japan calendar date.
CREATE TRIGGER new_spot_evidence_checks_premise BEFORE INSERT ON new_spot_evidence_checks
WHEN NOT EXISTS (SELECT 1 FROM reports r JOIN report_moderation m ON m.report_id=r.report_id
  WHERE r.report_id=NEW.report_id AND r.report_type='missing' AND r.redacted_at IS NULL
    AND julianday(r.minimize_after) > julianday(NEW.recorded_at) AND m.reconciliation_state='notQueued'
    AND m.state IN ('pending','needsInfo')
    AND NEW.checked_on >= date(r.received_at,'+9 hours') AND NEW.checked_on <= date(NEW.recorded_at,'+9 hours'))
BEGIN
 SELECT RAISE(ABORT,'new_spot_evidence_checks: report is not an open new-spot proposal or the check date is outside it');
END;
CREATE TRIGGER new_spot_evidence_checks_no_replace BEFORE INSERT ON new_spot_evidence_checks
WHEN EXISTS(SELECT 1 FROM new_spot_evidence_checks WHERE operation_id=NEW.operation_id) BEGIN
 SELECT RAISE(ABORT,'new_spot_evidence_checks: immutable');
END;
CREATE TRIGGER new_spot_evidence_checks_no_update BEFORE UPDATE ON new_spot_evidence_checks BEGIN
 SELECT RAISE(ABORT,'new_spot_evidence_checks: immutable');
END;
CREATE TRIGGER new_spot_evidence_checks_no_delete BEFORE DELETE ON new_spot_evidence_checks BEGIN
 SELECT RAISE(ABORT,'new_spot_evidence_checks: immutable');
END;

-- The export gate of 0009/0010 accepted only a viewable approved photo. 0010 is the stricter of the two and 0009 adds
-- nothing beyond it, so both are replaced by one trigger with the same photo premise OR a recorded independent check.
-- Applied 0009/0010 files are never edited; dropping their triggers here is the additive way to widen the premise.
DROP TRIGGER IF EXISTS report_reviews_new_spot_photo_evidence;
DROP TRIGGER IF EXISTS report_reviews_new_spot_photo_viewable;
CREATE TRIGGER report_reviews_new_spot_evidence
BEFORE UPDATE OF state ON report_reviews
WHEN NEW.state = 'exported' AND NEW.review_kind = 'newSpot' AND EXISTS (
  SELECT 1 FROM report_review_evidence e
  JOIN reports r ON r.report_id = e.report_id
  WHERE e.review_id = NEW.review_id AND r.report_type = 'missing' AND r.redacted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM community_evidence_photos p
                    WHERE p.report_id = r.report_id AND p.lifecycle = 'ready' AND p.moderation_status = 'approved'
                      AND julianday(p.delete_after) > julianday(NEW.exported_at, '+1 day')
                      AND NOT EXISTS (SELECT 1 FROM community_photo_deletions d WHERE d.storage_key = p.storage_key))
    AND NOT EXISTS (SELECT 1 FROM new_spot_evidence_checks c WHERE c.report_id = r.report_id))
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: a new-spot report has no viewable approved evidence photo and no independent check');
END;
