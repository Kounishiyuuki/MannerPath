-- Source refresh: raw artifact retention, fingerprinted checks and review candidates
-- (ADR-0008 decision 9, "Amendment 2026-09 — source refresh foundation"; strategy §10 step 5).
--
-- A check fetches a reviewed source's configured URL, fingerprints the bytes, retains them in R2 and records
-- what it saw. It writes only these three tables. It never creates a source_release, never touches a spot,
-- provenance row or tile, and never advances lastVerifiedAt: a changed file becomes a review candidate that a
-- maintainer takes through the existing reviewed flow (ingest -> observe -> resolve -> publish -> promote).
--
-- raw_artifacts             one row per distinct content hash stored in R2. Content-addressed: the R2 key is
--                           derived from the hash, so identical bytes are stored once, by any source.
-- source_checks             one row per check attempt, successful or not. Append-only. check_key makes a
--                           retried attempt (the same scheduled run for the same source) a no-op.
-- source_refresh_candidates one row per (source, content hash) a check found changed and not yet a release of
--                           that source. The reviewer's queue; nothing reads it automatically.
--
-- Large bytes never enter D1: raw_artifacts holds the key, size and hash only.

CREATE TABLE raw_artifacts (
  content_sha256 TEXT PRIMARY KEY CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- The R2 object key is a pure function of the hash, so a row can never point at other bytes.
  storage_key    TEXT NOT NULL UNIQUE CHECK (storage_key = 'raw/sha256/' || content_sha256),
  byte_length    INTEGER NOT NULL CHECK (byte_length >= 0),
  stored_at      TEXT NOT NULL
);

CREATE TRIGGER raw_artifacts_immutable
BEFORE UPDATE ON raw_artifacts
BEGIN
  SELECT RAISE(ABORT, 'raw_artifacts are immutable');
END;

CREATE TRIGGER raw_artifacts_no_delete
BEFORE DELETE ON raw_artifacts
BEGIN
  SELECT RAISE(ABORT, 'raw_artifacts are immutable');
END;

CREATE TABLE source_checks (
  check_id              INTEGER PRIMARY KEY,
  -- Idempotency key of the attempt: "<run key>:<source id>". A retry of the same run finds this row and
  -- writes nothing.
  check_key             TEXT NOT NULL UNIQUE CHECK (trim(check_key) <> ''),
  source_id             TEXT NOT NULL REFERENCES sources (source_id),
  trigger_kind          TEXT NOT NULL CHECK (trigger_kind IN ('scheduled', 'manual')),
  policy_version        TEXT NOT NULL CHECK (policy_version <> ''),
  request_url           TEXT NOT NULL CHECK (request_url <> ''),
  started_at            TEXT NOT NULL,
  finished_at           TEXT NOT NULL,
  -- HTTP metadata as received; NULL when the request never produced a response.
  final_url             TEXT,
  http_status           INTEGER,
  http_etag             TEXT,
  http_last_modified    TEXT,
  http_content_type     TEXT,
  -- The fingerprint of the bytes received, even when storing them failed.
  content_sha256        TEXT CHECK (content_sha256 IS NULL OR (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
  byte_length           INTEGER CHECK (byte_length IS NULL OR byte_length >= 0),
  -- Set only once the bytes are retained in R2.
  artifact_sha256       TEXT REFERENCES raw_artifacts (content_sha256),
  -- What the adapter's parser saw (NULL when it did not run or failed).
  header_json           TEXT CHECK (header_json IS NULL OR (json_valid(header_json) AND json_type(header_json) = 'array')),
  record_count          INTEGER CHECK (record_count IS NULL OR record_count >= 0),
  -- unchanged:   same hash as the baseline. Nothing but this row is written.
  -- changed:     a different hash with no drift finding; a review candidate.
  -- needsReview: a different hash with at least one drift finding; a review candidate that fails closed.
  -- failed:      fetch, HTTP or storage failure; no candidate.
  outcome               TEXT NOT NULL CHECK (outcome IN ('unchanged', 'changed', 'needsReview', 'failed')),
  failure_stage         TEXT CHECK (failure_stage IS NULL OR failure_stage IN ('fetch', 'http', 'tooLarge', 'storage')),
  -- JSON array of {"id", "detail"} drift findings, in a fixed order.
  findings_json         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(findings_json) AND json_type(findings_json) = 'array'),
  detail                TEXT,
  -- What this check was compared against: the previous successful check of the source, and the source's
  -- current applied release. Either may be absent (a first check, a source never applied).
  baseline_check_id     INTEGER REFERENCES source_checks (check_id),
  baseline_release_id   INTEGER REFERENCES source_releases (release_id),
  CHECK ((outcome = 'failed') = (failure_stage IS NOT NULL)),
  -- Every non-failed check names its retained artifact. Each operand is IS NOT NULL-guarded because a NULL
  -- comparison would make the CHECK unknown, which SQLite accepts.
  CHECK (outcome = 'failed' OR (content_sha256 IS NOT NULL AND artifact_sha256 IS NOT NULL
    AND artifact_sha256 = content_sha256 AND byte_length IS NOT NULL)),
  CHECK (artifact_sha256 IS NULL OR artifact_sha256 = content_sha256),
  CHECK ((outcome = 'needsReview') = (json_array_length(findings_json) > 0))
);

CREATE INDEX source_checks_source ON source_checks (source_id, check_id);

CREATE TRIGGER source_checks_immutable
BEFORE UPDATE ON source_checks
BEGIN
  SELECT RAISE(ABORT, 'source_checks are append-only');
END;

CREATE TRIGGER source_checks_no_delete
BEFORE DELETE ON source_checks
BEGIN
  SELECT RAISE(ABORT, 'source_checks are append-only');
END;

-- A baseline is an earlier successful check of the same source, never a failed one or another source's.
CREATE TRIGGER source_checks_baseline_valid
BEFORE INSERT ON source_checks
WHEN NEW.baseline_check_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM source_checks b
  WHERE b.check_id = NEW.baseline_check_id AND b.source_id = NEW.source_id AND b.outcome <> 'failed'
)
BEGIN
  SELECT RAISE(ABORT, 'source_checks: baseline must be an earlier successful check of the same source');
END;

CREATE TABLE source_refresh_candidates (
  candidate_id    INTEGER PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES sources (source_id),
  artifact_sha256 TEXT NOT NULL REFERENCES raw_artifacts (content_sha256),
  -- The check that first saw this content; later checks of the same content reuse the candidate.
  check_id        INTEGER NOT NULL UNIQUE REFERENCES source_checks (check_id),
  -- needsReview: the check had drift findings; the candidate must not be ingested without resolving them.
  review_state    TEXT NOT NULL CHECK (review_state IN ('changed', 'needsReview')),
  created_at      TEXT NOT NULL,
  UNIQUE (source_id, artifact_sha256)
);

CREATE TRIGGER source_refresh_candidates_valid
BEFORE INSERT ON source_refresh_candidates
WHEN NOT EXISTS (
  SELECT 1 FROM source_checks c
  WHERE c.check_id = NEW.check_id AND c.source_id = NEW.source_id AND c.artifact_sha256 = NEW.artifact_sha256
    AND c.outcome = NEW.review_state
)
BEGIN
  SELECT RAISE(ABORT, 'source_refresh_candidates: must cite a changed/needsReview check of the same source and artifact');
END;

CREATE TRIGGER source_refresh_candidates_immutable
BEFORE UPDATE ON source_refresh_candidates
BEGIN
  SELECT RAISE(ABORT, 'source_refresh_candidates are immutable');
END;

CREATE TRIGGER source_refresh_candidates_no_delete
BEFORE DELETE ON source_refresh_candidates
BEGIN
  SELECT RAISE(ABORT, 'source_refresh_candidates are immutable');
END;

-- 0016's guard names every table (test/promotion-empty-target.test.ts). A promotion bundle still bootstraps
-- only an empty database, so check history is part of "not empty": promote first, then enable checks.
DROP TRIGGER promotion_bootstraps_empty_target;

CREATE TRIGGER promotion_bootstraps_empty_target
BEFORE INSERT ON promotion_bootstraps
WHEN EXISTS (SELECT 1 FROM sources)
  OR EXISTS (SELECT 1 FROM source_releases)
  OR EXISTS (SELECT 1 FROM source_records)
  OR EXISTS (SELECT 1 FROM source_record_match_keys)
  OR EXISTS (SELECT 1 FROM source_observations)
  OR EXISTS (SELECT 1 FROM source_entities)
  OR EXISTS (SELECT 1 FROM source_record_entities)
  OR EXISTS (SELECT 1 FROM spots)
  OR EXISTS (SELECT 1 FROM spot_source_entities)
  OR EXISTS (SELECT 1 FROM spot_field_provenance)
  OR EXISTS (SELECT 1 FROM spot_field_attenuations)
  OR EXISTS (SELECT 1 FROM tile_snapshots)
  OR EXISTS (SELECT 1 FROM tile_snapshot_spots)
  OR EXISTS (SELECT 1 FROM review_items)
  OR EXISTS (SELECT 1 FROM review_decisions)
  OR EXISTS (SELECT 1 FROM review_removal_applications)
  OR EXISTS (SELECT 1 FROM review_removal_resolutions)
  OR EXISTS (SELECT 1 FROM review_match_applications)
  OR EXISTS (SELECT 1 FROM review_relocation_holds)
  OR EXISTS (SELECT 1 FROM review_relocation_applications)
  OR EXISTS (SELECT 1 FROM review_relocation_resolutions)
  OR EXISTS (SELECT 1 FROM reports)
  OR EXISTS (SELECT 1 FROM report_moderation)
  OR EXISTS (SELECT 1 FROM report_rate_windows)
  OR EXISTS (SELECT 1 FROM app_attest_keys)
  OR EXISTS (SELECT 1 FROM app_attest_challenges)
  OR EXISTS (SELECT 1 FROM promotion_bootstraps)
  OR EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
  OR EXISTS (SELECT 1 FROM promotion_review_match_attestations)
  OR EXISTS (SELECT 1 FROM raw_artifacts)
  OR EXISTS (SELECT 1 FROM source_checks)
  OR EXISTS (SELECT 1 FROM source_refresh_candidates)
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;
