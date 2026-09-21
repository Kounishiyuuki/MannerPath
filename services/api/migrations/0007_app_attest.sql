-- App Attest registration, one-time challenges and the per-key assertion counter (ADR-0007 §6,
-- Issue #37). Append-only; nothing here references reports, and no report references a key, so an
-- attested report is not linkable to the key (or install) that signed it.

-- A registered App Attest key: only what later assertion verification needs. The attestation
-- object, its certificates and its receipt are verified and discarded, never stored.
CREATE TABLE app_attest_keys (
  -- Standard base64 of SHA-256(public key), exactly as DCAppAttestService reports it.
  key_id               TEXT PRIMARY KEY CHECK (length(key_id) = 44 AND substr(key_id, 44) = '='
                         AND substr(key_id, 1, 43) NOT GLOB '*[^A-Za-z0-9+/]*'),
  -- X9.62 uncompressed P-256 point, lowercase hex. UNIQUE: one public key, one registration.
  public_key           TEXT NOT NULL UNIQUE CHECK (length(public_key) = 130 AND substr(public_key, 1, 2) = '04'
                         AND public_key NOT GLOB '*[^0-9a-f]*'),
  -- The aaguid environment the key was attested in; a key never crosses environments.
  environment          TEXT NOT NULL CHECK (environment IN ('development', 'production')),
  -- The latest accepted assertion counter. 0 = registered, no assertion accepted yet.
  sign_count           INTEGER NOT NULL CHECK (sign_count BETWEEN 0 AND 4294967295),
  registered_at        TEXT NOT NULL
);

-- A key is born with counter 0: Apple requires the attestation counter to be 0, and a higher
-- starting value would let one assertion replay "before" registration.
CREATE TRIGGER app_attest_keys_born_unused
BEFORE INSERT ON app_attest_keys
WHEN NEW.sign_count <> 0
BEGIN
  SELECT RAISE(ABORT, 'app_attest_keys: a key is registered with sign_count 0');
END;

-- The replay invariant, in the database: the counter only moves strictly forward and the key
-- material never changes. The report write batches this update with the report insert, so a
-- request that loses a counter race aborts the whole transaction and stores nothing.
CREATE TRIGGER app_attest_keys_counter_strictly_increases
BEFORE UPDATE ON app_attest_keys
WHEN NEW.sign_count <= OLD.sign_count
  OR NEW.key_id IS NOT OLD.key_id
  OR NEW.public_key IS NOT OLD.public_key
  OR NEW.environment IS NOT OLD.environment
  OR NEW.registered_at IS NOT OLD.registered_at
BEGIN
  SELECT RAISE(ABORT, 'app_attest_keys: sign_count must strictly increase and key material is immutable');
END;

-- Server-issued one-time challenges. `challenge` is 32 CSPRNG bytes, standard base64.
CREATE TABLE app_attest_challenges (
  challenge            TEXT PRIMARY KEY CHECK (length(challenge) = 44 AND substr(challenge, 44) = '='
                         AND substr(challenge, 1, 43) NOT GLOB '*[^A-Za-z0-9+/]*'),
  -- The domain a challenge may be used in. A registration challenge can never authorize a report
  -- and vice versa; the binding domains in src/attest/binding.ts separate them a second time.
  purpose              TEXT NOT NULL CHECK (purpose IN ('registration', 'report')),
  -- A report challenge is issued to one registered key; a registration challenge to none.
  key_id               TEXT REFERENCES app_attest_keys (key_id) ON DELETE CASCADE,
  issued_at            TEXT NOT NULL,
  expires_at           TEXT NOT NULL,
  -- Set exactly once, before verification runs, so a failed or replayed request still burns it.
  consumed_at          TEXT,
  CHECK ((purpose = 'report') = (key_id IS NOT NULL)),
  CHECK (expires_at > issued_at)
);

CREATE INDEX app_attest_challenges_outstanding ON app_attest_challenges (purpose, expires_at) WHERE consumed_at IS NULL;
CREATE INDEX app_attest_challenges_key ON app_attest_challenges (key_id) WHERE key_id IS NOT NULL;
CREATE INDEX app_attest_challenges_expiry ON app_attest_challenges (expires_at);

-- Consumption is the only update, and it is one-way: a consumed challenge can never be revived and
-- nothing else about a challenge can change after issuance.
CREATE TRIGGER app_attest_challenges_consume_once
BEFORE UPDATE ON app_attest_challenges
WHEN OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
  OR NEW.challenge IS NOT OLD.challenge
  OR NEW.purpose IS NOT OLD.purpose
  OR NEW.key_id IS NOT OLD.key_id
  OR NEW.issued_at IS NOT OLD.issued_at
  OR NEW.expires_at IS NOT OLD.expires_at
BEGIN
  SELECT RAISE(ABORT, 'app_attest_challenges: a challenge is consumed exactly once and is otherwise immutable');
END;

CREATE TRIGGER app_attest_challenges_born_unconsumed
BEFORE INSERT ON app_attest_challenges
WHEN NEW.consumed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'app_attest_challenges: a challenge is issued unconsumed');
END;
