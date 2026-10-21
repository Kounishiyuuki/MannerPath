-- Retry diagnostics contain no content, parent, hash, exception text or original metadata.
-- Separate table preserves 0003's two-column queue and its existing trigger INSERTs.
CREATE TABLE community_photo_deletion_attempts (
 storage_key TEXT PRIMARY KEY REFERENCES community_photo_deletions(storage_key) ON DELETE CASCADE,
 attempts INTEGER NOT NULL CHECK(attempts>0),
 last_attempt_at TEXT NOT NULL
);
