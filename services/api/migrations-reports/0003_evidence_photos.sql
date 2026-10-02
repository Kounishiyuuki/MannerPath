-- Private derivatives, never canonical evidence or public tile assets. A reservation precedes every object put.
CREATE TABLE community_evidence_photos (
 photo_id TEXT PRIMARY KEY,
 report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
 storage_key TEXT NOT NULL UNIQUE,
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
 media_type TEXT NOT NULL CHECK(media_type='image/png'),
 byte_length INTEGER NOT NULL CHECK(byte_length>0),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 lifecycle TEXT NOT NULL CHECK(lifecycle IN ('uploading','ready','deleting')),
 moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK(moderation_status IN ('pending','approved','rejected')),
 decided_by TEXT CHECK(decided_by IS NULL OR length(decided_by) BETWEEN 1 AND 64), decided_at TEXT,
 decision_reason TEXT CHECK(decision_reason IS NULL OR decision_reason IN('usableEvidence','privacyRisk','unrelated','unsafeContent','insufficientDetail')),
 created_at TEXT NOT NULL, upload_expires_at TEXT NOT NULL, delete_after TEXT NOT NULL,
 CHECK((moderation_status='pending')=(decided_by IS NULL)), CHECK((moderation_status='pending')=(decided_at IS NULL)), CHECK((moderation_status='pending')=(decision_reason IS NULL)),
 UNIQUE(report_id,content_sha256)
);
CREATE TABLE community_photo_requests (
 report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL,
 photo_id TEXT NOT NULL,
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(report_id,idempotency_key)
);
-- No FK: deletion work must survive deletion of its report and attachment row.
CREATE TABLE community_photo_deletions(storage_key TEXT PRIMARY KEY, queued_at TEXT NOT NULL);
CREATE INDEX community_photos_due ON community_evidence_photos(delete_after);
CREATE TRIGGER community_photos_before_delete BEFORE DELETE ON community_evidence_photos BEGIN
 INSERT INTO community_photo_deletions VALUES(OLD.storage_key,OLD.created_at) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER community_photos_report_redacted AFTER UPDATE OF redacted_at ON reports WHEN NEW.redacted_at IS NOT NULL BEGIN
 INSERT INTO community_photo_deletions SELECT storage_key,NEW.redacted_at FROM community_evidence_photos WHERE report_id=NEW.report_id ON CONFLICT DO NOTHING;
 UPDATE community_evidence_photos SET lifecycle='deleting' WHERE report_id=NEW.report_id;
 DELETE FROM community_photo_requests WHERE report_id=NEW.report_id;
END;
CREATE TRIGGER community_photos_eligible BEFORE INSERT ON community_evidence_photos BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reports WHERE report_id=NEW.report_id AND redacted_at IS NULL AND minimize_after>NEW.created_at AND minimize_after=NEW.delete_after) THEN RAISE(ABORT,'photo: report unavailable') END;
 SELECT CASE WHEN (SELECT count(*) FROM community_evidence_photos WHERE report_id=NEW.report_id)>=3 AND NOT EXISTS(SELECT 1 FROM community_evidence_photos WHERE report_id=NEW.report_id AND content_sha256=NEW.content_sha256) THEN RAISE(ABORT,'photo: attachment limit') END;
END;
CREATE TRIGGER community_photos_moderation BEFORE UPDATE OF moderation_status ON community_evidence_photos
WHEN NEW.moderation_status<>OLD.moderation_status AND NOT(OLD.moderation_status='pending' AND NEW.moderation_status IN ('approved','rejected') AND OLD.lifecycle='ready') BEGIN
 SELECT RAISE(ABORT,'photo: invalid moderation transition');
END;

CREATE TRIGGER community_photo_request_fixed BEFORE INSERT ON community_photo_requests
WHEN EXISTS(SELECT 1 FROM community_photo_requests WHERE report_id=NEW.report_id AND idempotency_key=NEW.idempotency_key AND (photo_id<>NEW.photo_id OR content_sha256<>NEW.content_sha256)) BEGIN
 SELECT RAISE(ABORT,'photo: idempotency conflict');
END;
CREATE TRIGGER community_photo_request_report BEFORE INSERT ON community_photo_requests
WHEN NOT EXISTS(SELECT 1 FROM community_evidence_photos WHERE photo_id=NEW.photo_id AND report_id=NEW.report_id) BEGIN
 SELECT RAISE(ABORT,'photo: request report mismatch');
END;
CREATE TRIGGER community_photos_identity_immutable BEFORE UPDATE ON community_evidence_photos
WHEN NEW.photo_id IS NOT OLD.photo_id OR NEW.report_id IS NOT OLD.report_id OR NEW.storage_key IS NOT OLD.storage_key
 OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.media_type IS NOT OLD.media_type
 OR NEW.byte_length IS NOT OLD.byte_length OR NEW.width IS NOT OLD.width OR NEW.height IS NOT OLD.height
 OR NEW.created_at IS NOT OLD.created_at OR NEW.upload_expires_at IS NOT OLD.upload_expires_at OR NEW.delete_after IS NOT OLD.delete_after BEGIN
 SELECT RAISE(ABORT,'photo: identity and retention are immutable');
END;
CREATE TRIGGER community_photos_lifecycle BEFORE UPDATE OF lifecycle ON community_evidence_photos
WHEN NEW.lifecycle<>OLD.lifecycle AND NOT(OLD.lifecycle='uploading' AND NEW.lifecycle IN('ready','deleting')) AND NOT(OLD.lifecycle='ready' AND NEW.lifecycle='deleting') BEGIN
 SELECT RAISE(ABORT,'photo: invalid lifecycle transition');
END;

CREATE TRIGGER community_photo_decision_immutable BEFORE UPDATE ON community_evidence_photos
WHEN OLD.moderation_status<>'pending' AND (NEW.decided_by IS NOT OLD.decided_by OR NEW.decided_at IS NOT OLD.decided_at OR NEW.decision_reason IS NOT OLD.decision_reason) BEGIN
 SELECT RAISE(ABORT,'photo: decision immutable');
END;

CREATE TRIGGER community_photo_deleting_queue AFTER UPDATE OF lifecycle ON community_evidence_photos
WHEN NEW.lifecycle='deleting' BEGIN
 INSERT INTO community_photo_deletions VALUES(NEW.storage_key,coalesce(NEW.decided_at,NEW.created_at)) ON CONFLICT DO NOTHING;
END;
