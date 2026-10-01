-- The durable community report store (ADR-0014). This stream migrates REPORTS_DB only; the canonical DATA_DB
-- (binding `DB`) has its own stream in ../migrations. The two never share a file, a number or a table.
--
-- REPORTS_DB is long-lived: blue/green promotion replaces DATA_DB and never touches this database, so it is never
-- bootstrapped from a bundle and never rebuilt from scratch. Every migration in this stream is therefore
-- append-only and must apply to a database that already holds reports: no DROP TABLE, no destructive rewrite.
--
-- 1. The report layer, exactly as the canonical stream left it after 0024 (0003, 0007, 0021, 0023, 0024): reports,
--    their moderation, the rate-limit windows, and App Attest keys and challenges. Same columns, same CHECKs, same
--    immutability and redaction triggers, so every module that reads or writes them runs unchanged.
-- 2. Community review: a reviewer's immutable decision over accepted, queued reports (new spot, existing-spot effect,
--    absence), with its evidence links. Independence of submitters is judged HERE, the only place the submitter key
--    exists. Exporting a review writes the sanitized evidence artifact (src/reports/review.ts) and moves its reports
--    to `applied`; nothing in this database ever writes DATA_DB.
-- 3. report_store_meta: what this database is and which schema it carries. Artifacts bind the schema value, and the
--    remote moderation tool refuses a database that does not say it is a report store.

CREATE TABLE report_store_meta (
  key   TEXT PRIMARY KEY CHECK (key IN ('store', 'schema')),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 64)
);

INSERT INTO report_store_meta (key, value) VALUES ('store', 'mannerpath-reports'), ('schema', 'reports-store.v1');

CREATE TRIGGER report_store_meta_no_delete
BEFORE DELETE ON report_store_meta
BEGIN
  SELECT RAISE(ABORT, 'report_store_meta: the store identity is never deleted');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Reports (ADR-0007). Nothing here references a canonical row: subject_spot_id is an opaque reference that is
-- resolved against DATA_DB only at review and import time (ADR-0014 §4).
CREATE TABLE reports (
  report_id              TEXT PRIMARY KEY CHECK (length(report_id) = 29 AND report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*'),
  schema_version         INTEGER NOT NULL CHECK (schema_version >= 1),
  report_type            TEXT NOT NULL CHECK (report_type IN (
                           'exists', 'missing', 'moved', 'hoursChanged',
                           'tobaccoTypeChanged', 'accessChanged', 'prohibited', 'other')),
  subject_spot_id        TEXT CHECK (subject_spot_id IS NULL OR (length(subject_spot_id) = 29 AND subject_spot_id GLOB 'sp_[0-9A-HJKMNP-TV-Z]*')),
  -- The proposed map pin (never the device's position), rounded to ~1 m by the API.
  proposed_latitude      REAL CHECK (proposed_latitude IS NULL OR proposed_latitude BETWEEN -90 AND 90),
  proposed_longitude     REAL CHECK (proposed_longitude IS NULL OR proposed_longitude BETWEEN -180 AND 180),
  -- Day precision only.
  observed_on            TEXT CHECK (observed_on IS NULL OR (
                           observed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
                           AND observed_on IS date(observed_on))),
  note                   TEXT CHECK (note IS NULL OR length(note) <= 280),
  -- SHA-256(pepper || installId or App Attest key). Never leaves this database (ADR-0014 §9).
  submitter_hash         TEXT CHECK (submitter_hash IS NULL OR (length(submitter_hash) = 64 AND submitter_hash NOT GLOB '*[^0-9a-f]*')),
  attestation_status     TEXT NOT NULL CHECK (attestation_status IN ('notProvided', 'verified', 'unverified')),
  received_at            TEXT NOT NULL,
  minimize_after         TEXT NOT NULL,
  redacted_at            TEXT,
  accepted_terms_version TEXT CHECK (accepted_terms_version IS NULL OR (length(accepted_terms_version) BETWEEN 1 AND 64
                           AND accepted_terms_version NOT GLOB '*[^a-z0-9.-]*')),
  claim_spot_type        TEXT CHECK (claim_spot_type IS NULL OR claim_spot_type IN (
                           'designatedOutdoorArea', 'publicSmokingRoom', 'facilitySmokingRoom', 'ashtray', 'smokingPermittedVenue', 'unknown')),
  claim_spot_subtype     TEXT CHECK (claim_spot_subtype IS NULL OR claim_spot_subtype IN ('smokingCorner', 'tobaccoShopSmokingSpace')),
  claim_access_type      TEXT CHECK (claim_access_type IS NULL OR claim_access_type IN ('public', 'customerOnly', 'facilityOnly', 'unknown')),
  claim_access_detail    TEXT CHECK (claim_access_detail IS NULL OR claim_access_detail IN ('ticketedUsersOnly')),
  claim_host_type        TEXT CHECK (claim_host_type IS NULL OR claim_host_type IN (
                           'municipality', 'station', 'airport', 'commercialBuilding', 'convenienceStore', 'tobaccoShop', 'restaurantOrCafe', 'other', 'unknown')),
  claim_environment      TEXT CHECK (claim_environment IS NULL OR claim_environment IN ('indoor', 'outdoor', 'covered', 'unknown')),
  claim_supports_paper   TEXT CHECK (claim_supports_paper IS NULL OR claim_supports_paper IN ('yes', 'no', 'unknown')),
  claim_supports_heated  TEXT CHECK (claim_supports_heated IS NULL OR claim_supports_heated IN ('yes', 'no', 'unknown')),
  claim_host_name        TEXT CHECK (claim_host_name IS NULL OR length(claim_host_name) BETWEEN 1 AND 80),
  claim_hours_note       TEXT CHECK (claim_hours_note IS NULL OR length(claim_hours_note) BETWEEN 1 AND 120),
  finding                TEXT CHECK (finding IS NULL OR finding IN ('notFound', 'removed', 'wrongType')),
  CHECK (minimize_after > received_at),
  CHECK ((proposed_latitude IS NULL) = (proposed_longitude IS NULL)),
  CHECK (proposed_latitude IS NULL OR report_type IN ('missing', 'moved')),
  CHECK ((subject_spot_id IS NULL) = (report_type = 'missing')),
  CHECK (redacted_at IS NULL OR (note IS NULL AND proposed_latitude IS NULL AND observed_on IS NULL AND submitter_hash IS NULL))
);

-- The consent record: which reviewed terms document a report's submitter accepted (src/reports/terms.ts). It names a
-- document, never rights: whether a version grants publication is a canonical publication decision and lives only in
-- DATA_DB's report_terms_versions mirror. A version is written here before the first report that names it.
CREATE TABLE report_terms_documents (
  terms_version   TEXT PRIMARY KEY CHECK (length(terms_version) BETWEEN 1 AND 64 AND terms_version NOT GLOB '*[^a-z0-9.-]*'),
  document_path   TEXT NOT NULL CHECK (document_path <> ''),
  document_sha256 TEXT NOT NULL CHECK (length(document_sha256) = 64 AND document_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at      TEXT NOT NULL
);

CREATE TRIGGER report_terms_documents_immutable
BEFORE UPDATE ON report_terms_documents
BEGIN
  SELECT RAISE(ABORT, 'report_terms_documents: a terms version names one document forever');
END;

CREATE TRIGGER report_terms_documents_no_delete
BEFORE DELETE ON report_terms_documents
BEGIN
  SELECT RAISE(ABORT, 'report_terms_documents: a consented terms version is never deleted');
END;

CREATE TRIGGER reports_consent_names_a_document
BEFORE INSERT ON reports
WHEN NEW.accepted_terms_version IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM report_terms_documents t WHERE t.terms_version = NEW.accepted_terms_version)
BEGIN
  SELECT RAISE(ABORT, 'reports: consent must name a recorded terms document');
END;

CREATE INDEX reports_subject_spot ON reports (subject_spot_id) WHERE subject_spot_id IS NOT NULL;
CREATE INDEX reports_minimize_due ON reports (minimize_after) WHERE redacted_at IS NULL;

CREATE TABLE report_moderation (
  report_id            TEXT PRIMARY KEY REFERENCES reports (report_id) ON DELETE CASCADE,
  state                TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'duplicate', 'needsInfo')),
  -- `applied` here means: exported in a reviewed, sanitized evidence artifact (an exported report_reviews row).
  reconciliation_state TEXT NOT NULL DEFAULT 'notQueued' CHECK (reconciliation_state IN ('notQueued', 'queued', 'applied', 'discarded')),
  decided_at           TEXT,
  decided_by           TEXT,
  decision_reason      TEXT CHECK (decision_reason IS NULL OR decision_reason IN (
                         'confirmed', 'contradictedBySource', 'insufficientDetail',
                         'duplicateOfExistingReport', 'outOfScope', 'abuse', 'unspecified')),
  updated_at           TEXT NOT NULL,
  CHECK ((state = 'pending') = (decided_at IS NULL)),
  CHECK ((state = 'pending') = (decided_by IS NULL)),
  CHECK ((state = 'pending') = (decision_reason IS NULL)),
  CHECK (reconciliation_state = 'notQueued' OR state = 'accepted')
);

CREATE INDEX report_moderation_queue ON report_moderation (state, updated_at);

CREATE TRIGGER report_moderation_no_reopen
BEFORE UPDATE ON report_moderation
WHEN NEW.state = 'pending' AND OLD.state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: a decided report cannot return to pending');
END;

CREATE TRIGGER report_moderation_reconciliation_starts_unqueued
BEFORE INSERT ON report_moderation
WHEN NEW.reconciliation_state <> 'notQueued'
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: reconciliation starts at notQueued');
END;

CREATE TRIGGER report_moderation_report_fixed
BEFORE UPDATE OF report_id ON report_moderation
WHEN NEW.report_id IS NOT OLD.report_id
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: a decision belongs to one report');
END;

CREATE TABLE report_rate_windows (
  submitter_hash       TEXT NOT NULL CHECK (length(submitter_hash) = 64 AND submitter_hash NOT GLOB '*[^0-9a-f]*'),
  window_kind          TEXT NOT NULL CHECK (window_kind IN ('hour', 'day')),
  window_start         TEXT NOT NULL,
  report_count         INTEGER NOT NULL CHECK (report_count >= 0),
  expires_at           TEXT NOT NULL,
  PRIMARY KEY (submitter_hash, window_kind, window_start)
);

CREATE INDEX report_rate_windows_expiry ON report_rate_windows (expires_at);

CREATE TABLE app_attest_keys (
  key_id               TEXT PRIMARY KEY CHECK (length(key_id) = 44 AND substr(key_id, 44) = '='
                         AND substr(key_id, 1, 43) NOT GLOB '*[^A-Za-z0-9+/]*'),
  public_key           TEXT NOT NULL UNIQUE CHECK (length(public_key) = 130 AND substr(public_key, 1, 2) = '04'
                         AND public_key NOT GLOB '*[^0-9a-f]*'),
  environment          TEXT NOT NULL CHECK (environment IN ('development', 'production')),
  sign_count           INTEGER NOT NULL CHECK (sign_count BETWEEN 0 AND 4294967295),
  registered_at        TEXT NOT NULL
);

CREATE TRIGGER app_attest_keys_born_unused
BEFORE INSERT ON app_attest_keys
WHEN NEW.sign_count <> 0
BEGIN
  SELECT RAISE(ABORT, 'app_attest_keys: a key is registered with sign_count 0');
END;

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

CREATE TABLE app_attest_challenges (
  challenge            TEXT PRIMARY KEY CHECK (length(challenge) = 44 AND substr(challenge, 44) = '='
                         AND substr(challenge, 1, 43) NOT GLOB '*[^A-Za-z0-9+/]*'),
  purpose              TEXT NOT NULL CHECK (purpose IN ('registration', 'report')),
  key_id               TEXT REFERENCES app_attest_keys (key_id) ON DELETE CASCADE,
  issued_at            TEXT NOT NULL,
  expires_at           TEXT NOT NULL,
  consumed_at          TEXT,
  CHECK ((purpose = 'report') = (key_id IS NOT NULL)),
  CHECK (expires_at > issued_at)
);

CREATE INDEX app_attest_challenges_outstanding ON app_attest_challenges (purpose, expires_at) WHERE consumed_at IS NULL;
CREATE INDEX app_attest_challenges_key ON app_attest_challenges (key_id) WHERE key_id IS NOT NULL;
CREATE INDEX app_attest_challenges_expiry ON app_attest_challenges (expires_at);

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

CREATE TRIGGER reports_claim_refinements_consistent
BEFORE INSERT ON reports
WHEN (NEW.claim_spot_subtype IS NOT NULL AND NEW.claim_spot_type IS NULL)
  OR (NEW.claim_access_detail IS NOT NULL AND NEW.claim_access_type IS NOT 'facilityOnly')
BEGIN
  SELECT RAISE(ABORT, 'reports: a spot subtype needs a spot type, and ticketedUsersOnly refines facilityOnly');
END;

CREATE TRIGGER reports_only_redaction_updates
BEFORE UPDATE ON reports
WHEN NEW.report_id IS NOT OLD.report_id
  OR NEW.schema_version IS NOT OLD.schema_version
  OR NEW.report_type IS NOT OLD.report_type
  OR NEW.subject_spot_id IS NOT OLD.subject_spot_id
  OR NEW.attestation_status IS NOT OLD.attestation_status
  OR NEW.received_at IS NOT OLD.received_at
  OR NEW.minimize_after IS NOT OLD.minimize_after
  OR NEW.accepted_terms_version IS NOT OLD.accepted_terms_version
  OR NEW.redacted_at IS NULL
  OR OLD.redacted_at IS NOT NULL
  OR (NEW.note IS NOT OLD.note AND NEW.note IS NOT NULL)
  OR (NEW.proposed_latitude IS NOT OLD.proposed_latitude AND NEW.proposed_latitude IS NOT NULL)
  OR (NEW.proposed_longitude IS NOT OLD.proposed_longitude AND NEW.proposed_longitude IS NOT NULL)
  OR (NEW.observed_on IS NOT OLD.observed_on AND NEW.observed_on IS NOT NULL)
  OR (NEW.submitter_hash IS NOT OLD.submitter_hash AND NEW.submitter_hash IS NOT NULL)
  OR (NEW.claim_host_name IS NOT OLD.claim_host_name AND NEW.claim_host_name IS NOT NULL)
  OR (NEW.claim_hours_note IS NOT OLD.claim_hours_note AND NEW.claim_hours_note IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'reports are immutable proposals; the only permitted update is redaction to NULL');
END;

CREATE TRIGGER reports_claims_immutable
BEFORE UPDATE ON reports
WHEN NEW.claim_spot_type IS NOT OLD.claim_spot_type OR NEW.claim_spot_subtype IS NOT OLD.claim_spot_subtype
  OR NEW.claim_access_type IS NOT OLD.claim_access_type OR NEW.claim_access_detail IS NOT OLD.claim_access_detail
  OR NEW.claim_host_type IS NOT OLD.claim_host_type OR NEW.claim_environment IS NOT OLD.claim_environment
  OR NEW.claim_supports_paper IS NOT OLD.claim_supports_paper OR NEW.claim_supports_heated IS NOT OLD.claim_supports_heated
BEGIN
  SELECT RAISE(ABORT, 'reports: categorical claims are part of the immutable proposal');
END;

CREATE TRIGGER reports_redaction_clears_claim_text
BEFORE UPDATE ON reports
WHEN NEW.redacted_at IS NOT NULL AND (NEW.claim_host_name IS NOT NULL OR NEW.claim_hours_note IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'reports: redaction clears the free-text claims together with the other personal content');
END;

CREATE TRIGGER reports_finding_only_on_other
BEFORE INSERT ON reports
WHEN NEW.finding IS NOT NULL AND NEW.report_type <> 'other'
BEGIN
  SELECT RAISE(ABORT, 'reports: a finding is stored only on an other report');
END;

CREATE TRIGGER reports_finding_immutable
BEFORE UPDATE ON reports
WHEN NEW.finding IS NOT OLD.finding
BEGIN
  SELECT RAISE(ABORT, 'reports: a finding is part of the immutable proposal');
END;

CREATE TRIGGER reports_claims_only_on_missing
BEFORE INSERT ON reports
WHEN NEW.report_type <> 'missing' AND (
  ((NEW.claim_spot_type IS NOT NULL OR NEW.claim_spot_subtype IS NOT NULL)
    AND NOT (NEW.report_type = 'other' AND NEW.finding IS 'wrongType'))
  OR ((NEW.claim_access_type IS NOT NULL OR NEW.claim_access_detail IS NOT NULL) AND NEW.report_type <> 'accessChanged')
  OR ((NEW.claim_supports_paper IS NOT NULL OR NEW.claim_supports_heated IS NOT NULL) AND NEW.report_type <> 'tobaccoTypeChanged')
  OR NEW.claim_host_type IS NOT NULL OR NEW.claim_environment IS NOT NULL
  OR NEW.claim_host_name IS NOT NULL OR NEW.claim_hours_note IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'reports: this claim is not accepted on this report type');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Community review.
--
-- review_id is the identity the canonical side keeps for the decision: it becomes the DATA_DB application ID
-- (ca_ new spot, ce_ existing-spot effect, cn_ absence). review_key names what is being decided about; each new
-- decision about the same key gets the next decision_version, and the canonical ledger refuses an older one
-- (ADR-0014 §12). A withdrawn review keeps its reports, so a superseded decision is never re-used silently.
CREATE TABLE report_reviews (
  review_id          TEXT PRIMARY KEY CHECK (length(review_id) = 29 AND (
                       (review_kind = 'newSpot' AND review_id GLOB 'ca_[0-9A-HJKMNP-TV-Z]*')
                       OR (review_kind = 'effect' AND review_id GLOB 'ce_[0-9A-HJKMNP-TV-Z]*')
                       OR (review_kind = 'absence' AND review_id GLOB 'cn_[0-9A-HJKMNP-TV-Z]*'))),
  review_kind        TEXT NOT NULL CHECK (review_kind IN ('newSpot', 'effect', 'absence')),
  review_key         TEXT NOT NULL CHECK (length(review_key) BETWEEN 1 AND 128),
  decision_version   INTEGER NOT NULL CHECK (decision_version >= 1),
  rule_version       TEXT NOT NULL CHECK (
                       (review_kind = 'newSpot' AND rule_version = 'community-reconciliation.v1')
                       OR (review_kind = 'effect' AND rule_version = 'community-effects.v1')
                       OR (review_kind = 'absence' AND rule_version = 'community-absence.v1')),
  -- Existing-spot reviews: the opaque spot reference every evidence report names. Not a foreign key; the canonical
  -- import re-checks it against DATA_DB and fails closed when it no longer names a live spot.
  subject_spot_id    TEXT CHECK (subject_spot_id IS NULL OR (length(subject_spot_id) = 29 AND subject_spot_id GLOB 'sp_[0-9A-HJKMNP-TV-Z]*')),
  report_type        TEXT CHECK (report_type IS NULL OR report_type IN ('moved', 'prohibited', 'hoursChanged', 'accessChanged', 'tobaccoTypeChanged', 'exists')),
  evidence_tier      TEXT CHECK (evidence_tier IS NULL OR evidence_tier IN ('communityReported', 'communityVerified')),
  location_report_id TEXT CHECK (location_report_id IS NULL OR (length(location_report_id) = 29 AND location_report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*')),
  -- An `exists` effect that confirms a communityReported spot: the report IDs behind that spot as DATA_DB lists them
  -- (sorted, space-separated). Independence over (these ∪ the confirmations) is judged here and attested.
  base_report_ids    TEXT CHECK (base_report_ids IS NULL OR base_report_ids GLOB 'rp_*'),
  decided_by         TEXT NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 64),
  decided_at         TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('proposed', 'exported', 'withdrawn')),
  artifact_sha256    TEXT CHECK (artifact_sha256 IS NULL OR (length(artifact_sha256) = 64 AND artifact_sha256 NOT GLOB '*[^0-9a-f]*')),
  exported_at        TEXT,
  withdrawn_at       TEXT,
  UNIQUE (review_key, decision_version),
  CHECK ((review_kind = 'newSpot') = (subject_spot_id IS NULL)),
  CHECK ((review_kind = 'newSpot') = (evidence_tier IS NOT NULL)),
  CHECK ((review_kind = 'newSpot') = (location_report_id IS NOT NULL)),
  CHECK ((review_kind = 'effect') = (report_type IS NOT NULL)),
  CHECK (base_report_ids IS NULL OR report_type = 'exists'),
  CHECK ((state = 'exported') = (artifact_sha256 IS NOT NULL)),
  CHECK ((state = 'exported') = (exported_at IS NOT NULL)),
  CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);

CREATE INDEX report_reviews_state ON report_reviews (state, decided_at);

CREATE TABLE report_review_evidence (
  report_id TEXT PRIMARY KEY REFERENCES reports (report_id),
  review_id TEXT NOT NULL REFERENCES report_reviews (review_id)
);

CREATE INDEX report_review_evidence_review ON report_review_evidence (review_id);

CREATE TRIGGER report_reviews_born_proposed
BEFORE INSERT ON report_reviews
WHEN NEW.state <> 'proposed'
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: a review is born proposed');
END;

-- A new decision about a key is the next version, and only once every earlier decision about it is terminal.
CREATE TRIGGER report_reviews_next_decision_version
BEFORE INSERT ON report_reviews
WHEN NEW.decision_version IS NOT (SELECT coalesce(max(decision_version), 0) + 1 FROM report_reviews WHERE review_key = NEW.review_key)
  OR EXISTS (SELECT 1 FROM report_reviews WHERE review_key = NEW.review_key AND state = 'proposed')
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: a new decision is the next decision_version of its key, after the previous one is exported or withdrawn');
END;

CREATE TRIGGER report_reviews_decision_immutable
BEFORE UPDATE ON report_reviews
WHEN NEW.review_id IS NOT OLD.review_id OR NEW.review_kind IS NOT OLD.review_kind OR NEW.review_key IS NOT OLD.review_key
  OR NEW.decision_version IS NOT OLD.decision_version OR NEW.rule_version IS NOT OLD.rule_version
  OR NEW.subject_spot_id IS NOT OLD.subject_spot_id OR NEW.report_type IS NOT OLD.report_type
  OR NEW.evidence_tier IS NOT OLD.evidence_tier OR NEW.location_report_id IS NOT OLD.location_report_id
  OR NEW.base_report_ids IS NOT OLD.base_report_ids OR NEW.decided_by IS NOT OLD.decided_by OR NEW.decided_at IS NOT OLD.decided_at
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: a reviewed decision is immutable');
END;

CREATE TRIGGER report_reviews_one_way
BEFORE UPDATE ON report_reviews
WHEN NOT (OLD.state = 'proposed' AND NEW.state IN ('exported', 'withdrawn'))
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: only proposed -> exported or proposed -> withdrawn');
END;

CREATE TRIGGER report_reviews_no_delete
BEFORE DELETE ON report_reviews
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: reviews are never deleted');
END;

CREATE TRIGGER report_review_evidence_review_proposed
BEFORE INSERT ON report_review_evidence
WHEN NOT EXISTS (SELECT 1 FROM report_reviews v WHERE v.review_id = NEW.review_id AND v.state = 'proposed')
BEGIN
  SELECT RAISE(ABORT, 'report_review_evidence: the review is not proposed');
END;

CREATE TRIGGER report_review_evidence_report_eligible
BEFORE INSERT ON report_review_evidence
WHEN NOT EXISTS (SELECT 1 FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
                 WHERE r.report_id = NEW.report_id AND r.redacted_at IS NULL
                   AND m.state = 'accepted' AND m.reconciliation_state = 'queued')
BEGIN
  SELECT RAISE(ABORT, 'report_review_evidence: the report is not an accepted, queued, unredacted report');
END;

CREATE TRIGGER report_review_evidence_immutable
BEFORE UPDATE ON report_review_evidence
BEGIN
  SELECT RAISE(ABORT, 'report_review_evidence: evidence links are immutable');
END;

CREATE TRIGGER report_review_evidence_no_delete
BEFORE DELETE ON report_review_evidence
BEGIN
  SELECT RAISE(ABORT, 'report_review_evidence: evidence links are never deleted');
END;

-- Export premise, re-checked inside the export batch (the review UPDATE is its first statement): every linked report
-- is still accepted, queued, unredacted and inside its minimization window.
CREATE TRIGGER report_reviews_export_premised
BEFORE UPDATE OF state ON report_reviews
WHEN NEW.state = 'exported' AND (
  NOT EXISTS (SELECT 1 FROM report_review_evidence e WHERE e.review_id = NEW.review_id)
  OR EXISTS (
    SELECT 1 FROM report_review_evidence e
    LEFT JOIN reports r ON r.report_id = e.report_id
    LEFT JOIN report_moderation m ON m.report_id = e.report_id
    WHERE e.review_id = NEW.review_id
      AND (r.redacted_at IS NOT NULL OR r.minimize_after <= NEW.exported_at
        OR m.state IS NOT 'accepted' OR m.reconciliation_state IS NOT 'queued')))
BEGIN
  SELECT RAISE(ABORT, 'report_reviews: a linked report is no longer accepted, queued and unredacted');
END;

-- notQueued -> queued | discarded, queued -> discarded, and queued -> applied only for a report linked to an exported
-- review (set earlier in the same batch).
CREATE TRIGGER report_moderation_reconciliation_transitions
BEFORE UPDATE OF reconciliation_state ON report_moderation
WHEN NEW.reconciliation_state <> OLD.reconciliation_state
  AND NOT (OLD.reconciliation_state = 'notQueued' AND NEW.reconciliation_state IN ('queued', 'discarded'))
  AND NOT (OLD.reconciliation_state = 'queued' AND NEW.reconciliation_state = 'discarded')
  AND NOT (OLD.reconciliation_state = 'queued' AND NEW.reconciliation_state = 'applied'
    AND EXISTS (SELECT 1 FROM report_review_evidence e JOIN report_reviews v ON v.review_id = e.review_id
                WHERE e.report_id = NEW.report_id AND v.state = 'exported'))
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: illegal reconciliation transition (allowed: notQueued->queued, notQueued->discarded, queued->discarded, queued->applied only through an exported review)');
END;
