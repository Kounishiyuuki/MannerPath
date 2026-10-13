-- App Attest key revocation (ADR-0007 §6, docs/OPERATIONS.md "Revoke an App Attest key"). Forward-only and additive.
--
-- A revocation is one append-only row per key, written only by the maintainer CLI (scripts/report-queue.ts
-- revoke-key); there is no HTTP admin surface. It is permanent: there is no un-revoke, a revoked key's row in
-- app_attest_keys cannot be deleted (so its keyId can never be registered again), and the row itself is the audit
-- record (reason is a closed code, never free text, so no personal data or secret can be recorded in it).
--
-- Enforcement lives in the database as well as in the Worker: a revoked key's counter can no longer advance, and
-- every report or photo write batches that advance, so a revocation that commits while a request is between
-- verification and commit aborts that request's whole batch. Existing reports, moderation and receipts are untouched.
-- Plain boolean trigger conditions only (REPORTS_MIGRATION_RECOVERY.md, workers-sdk #4727).

CREATE TABLE app_attest_key_revocations (
  key_id       TEXT PRIMARY KEY REFERENCES app_attest_keys (key_id) ON DELETE RESTRICT,
  reason       TEXT NOT NULL CHECK (reason IN ('compromised', 'abuse', 'maintainerRequest')),
  revoked_at   TEXT NOT NULL
);

CREATE TRIGGER app_attest_key_revocations_append_only
BEFORE UPDATE ON app_attest_key_revocations
BEGIN
  SELECT RAISE(ABORT, 'app_attest_key_revocations: a revocation is append-only');
END;

CREATE TRIGGER app_attest_key_revocations_no_delete
BEFORE DELETE ON app_attest_key_revocations
BEGIN
  SELECT RAISE(ABORT, 'app_attest_key_revocations: a revocation is append-only');
END;

CREATE TRIGGER app_attest_keys_revoked_counter
BEFORE UPDATE OF sign_count ON app_attest_keys
WHEN EXISTS (SELECT 1 FROM app_attest_key_revocations WHERE key_id = OLD.key_id)
BEGIN
  SELECT RAISE(ABORT, 'app_attest_keys: key revoked');
END;

CREATE TRIGGER app_attest_challenges_revoked_key
BEFORE INSERT ON app_attest_challenges
WHEN NEW.key_id IS NOT NULL AND EXISTS (SELECT 1 FROM app_attest_key_revocations WHERE key_id = NEW.key_id)
BEGIN
  SELECT RAISE(ABORT, 'app_attest_keys: key revoked');
END;
