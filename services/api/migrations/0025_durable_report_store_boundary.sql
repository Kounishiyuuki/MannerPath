-- Durable community report store: the canonical side of the boundary (ADR-0014, Issue #67 child).
--
-- Raw reports, their moderation, rate-limit windows and App Attest state now live in the long-lived REPORTS_DB
-- (../migrations-reports). This canonical database is replaced on every blue/green promotion, so nothing that must
-- outlive a cutover may live here. What crosses the boundary is a reviewed, sanitized evidence ARTIFACT
-- (src/reports/review.ts writes it, src/pipeline/community-artifact.ts imports it), never a report row.
--
-- 1. The legacy report tables of 0003/0007/0021-0024 stay (no destructive migration) but become inert: no new row may
--    be written to them here. Rows a local database already holds are kept, untouched, and are never evidence again.
-- 2. community_artifact_ledger: one append-only row per imported artifact, bound to its SHA-256, its schema, the
--    report-store schema it was generated from, the review identity, the decision version, the terms version and
--    the independence attestation. Re-importing the same bytes is a no-op; another digest for the same review is a
--    conflict; an older decision version than one already imported is stale. The database refuses all three.
-- 3. community_evidence_reports: the sanitized evidence rows an artifact carries. A report ID (the non-personal
--    ADR-0007 §4 skeleton), its type/finding/subject, structured claims, its consent, the pin ONLY where the review
--    adopts one, and the last day the evidence may be used. No note, submitter key, observation date, receipt time,
--    attestation or free text exists here.
-- 4. Every guard that used to read `reports`/`report_moderation` reads the sanitized evidence and the ledger instead.
--    Independence is no longer recomputed from submitter keys (they never reach this database): it is the attested,
--    digest-bound count from REPORTS_DB, and each guard checks the count it needs against the ledger.
--
-- Each guard is its own small trigger (0018/0019: one large trigger exceeded D1's expression depth limit).

-- ---------------------------------------------------------------------------------------------------------
-- 1. Legacy report tables are inert in the canonical database.
CREATE TRIGGER legacy_reports_inert
BEFORE INSERT ON reports
BEGIN
  SELECT RAISE(ABORT, 'reports: raw reports live in REPORTS_DB (ADR-0014); the canonical database stores none');
END;

CREATE TRIGGER legacy_report_moderation_inert
BEFORE INSERT ON report_moderation
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: moderation lives in REPORTS_DB (ADR-0014)');
END;

CREATE TRIGGER legacy_report_rate_windows_inert
BEFORE INSERT ON report_rate_windows
BEGIN
  SELECT RAISE(ABORT, 'report_rate_windows: anti-abuse state lives in REPORTS_DB (ADR-0014)');
END;

CREATE TRIGGER legacy_app_attest_keys_inert
BEFORE INSERT ON app_attest_keys
BEGIN
  SELECT RAISE(ABORT, 'app_attest_keys: App Attest state lives in REPORTS_DB (ADR-0014)');
END;

CREATE TRIGGER legacy_app_attest_challenges_inert
BEFORE INSERT ON app_attest_challenges
BEGIN
  SELECT RAISE(ABORT, 'app_attest_challenges: App Attest state lives in REPORTS_DB (ADR-0014)');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 2. The applied-artifact ledger.
CREATE TABLE community_artifact_ledger (
  artifact_sha256             TEXT PRIMARY KEY CHECK (length(artifact_sha256) = 64 AND artifact_sha256 NOT GLOB '*[^0-9a-f]*'),
  artifact_schema_version     INTEGER NOT NULL CHECK (artifact_schema_version = 1),
  report_store_schema         TEXT NOT NULL CHECK (report_store_schema = 'reports-store.v1'),
  review_id                   TEXT NOT NULL UNIQUE CHECK (length(review_id) = 29 AND (
                                (review_kind = 'newSpot' AND review_id GLOB 'ca_[0-9A-HJKMNP-TV-Z]*')
                                OR (review_kind = 'effect' AND review_id GLOB 'ce_[0-9A-HJKMNP-TV-Z]*')
                                OR (review_kind = 'absence' AND review_id GLOB 'cn_[0-9A-HJKMNP-TV-Z]*'))),
  review_kind                 TEXT NOT NULL CHECK (review_kind IN ('newSpot', 'effect', 'absence')),
  review_key                  TEXT NOT NULL CHECK (length(review_key) BETWEEN 1 AND 128),
  decision_version            INTEGER NOT NULL CHECK (decision_version >= 1),
  rule_version                TEXT NOT NULL,
  -- The one terms version every evidence report consented to, or NULL: no common consent is no rights basis.
  terms_version               TEXT CHECK (terms_version IS NULL OR (length(terms_version) BETWEEN 1 AND 64 AND terms_version NOT GLOB '*[^a-z0-9.-]*')),
  independence_version        TEXT NOT NULL CHECK (independence_version = 'community-independence.v1'),
  evidence_count              INTEGER NOT NULL CHECK (evidence_count >= 1),
  -- Distinct submitters behind the evidence, judged in REPORTS_DB where the keys exist. A count, never a key.
  independent_submitters      INTEGER NOT NULL CHECK (independent_submitters BETWEEN 1 AND evidence_count),
  -- An `exists` confirmation of a communityReported spot: the spot's own evidence report IDs (JSON array), their
  -- distinct submitters, and the distinct submitters over (those ∪ the confirmations), all attested together.
  base_report_ids             TEXT CHECK (base_report_ids IS NULL OR json_valid(base_report_ids)),
  base_independent_submitters INTEGER CHECK (base_independent_submitters IS NULL OR base_independent_submitters >= 1),
  confirmations_after         INTEGER CHECK (confirmations_after IS NULL OR confirmations_after >= 2),
  imported_at                 TEXT NOT NULL,
  UNIQUE (review_key, decision_version),
  CHECK ((base_report_ids IS NULL) = (base_independent_submitters IS NULL)),
  CHECK ((base_report_ids IS NULL) = (confirmations_after IS NULL)),
  CHECK (confirmations_after IS NULL OR confirmations_after > base_independent_submitters)
);

CREATE INDEX community_artifact_ledger_key ON community_artifact_ledger (review_key, decision_version);

-- A newer decision about the same key may follow; an older (or equal) one never comes after it.
CREATE TRIGGER community_artifact_ledger_not_stale
BEFORE INSERT ON community_artifact_ledger
WHEN EXISTS (SELECT 1 FROM community_artifact_ledger l WHERE l.review_key = NEW.review_key AND l.decision_version >= NEW.decision_version)
BEGIN
  SELECT RAISE(ABORT, 'community_artifact_ledger: stale artifact (a newer or equal decision about this review key was already imported)');
END;

CREATE TRIGGER community_artifact_ledger_immutable
BEFORE UPDATE ON community_artifact_ledger
BEGIN
  SELECT RAISE(ABORT, 'community_artifact_ledger: an imported artifact is immutable; a new decision is a new artifact');
END;

CREATE TRIGGER community_artifact_ledger_no_delete
BEFORE DELETE ON community_artifact_ledger
BEGIN
  SELECT RAISE(ABORT, 'community_artifact_ledger: the ledger is append-only');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Sanitized evidence.
CREATE TABLE community_evidence_reports (
  report_id              TEXT PRIMARY KEY CHECK (length(report_id) = 29 AND report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*'),
  artifact_sha256        TEXT NOT NULL REFERENCES community_artifact_ledger (artifact_sha256),
  review_id              TEXT NOT NULL,
  report_type            TEXT NOT NULL CHECK (report_type IN (
                           'exists', 'missing', 'moved', 'hoursChanged', 'tobaccoTypeChanged', 'accessChanged', 'prohibited', 'other')),
  finding                TEXT CHECK (finding IS NULL OR finding IN ('notFound', 'removed', 'wrongType')),
  subject_spot_id        TEXT CHECK (subject_spot_id IS NULL OR (length(subject_spot_id) = 29 AND subject_spot_id GLOB 'sp_[0-9A-HJKMNP-TV-Z]*')),
  proposed_latitude      REAL CHECK (proposed_latitude IS NULL OR proposed_latitude BETWEEN -90 AND 90),
  proposed_longitude     REAL CHECK (proposed_longitude IS NULL OR proposed_longitude BETWEEN -180 AND 180),
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
  -- The evidence may back a canonical change only on days before this one (day precision: the report's own receipt
  -- time is personal and never crosses the boundary; this is its minimization day, rounded to the day).
  usable_until           TEXT NOT NULL CHECK (usable_until GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND usable_until IS date(usable_until)),
  CHECK ((proposed_latitude IS NULL) = (proposed_longitude IS NULL)),
  CHECK (proposed_latitude IS NULL OR report_type IN ('missing', 'moved')),
  CHECK ((subject_spot_id IS NULL) = (report_type = 'missing'))
);

CREATE INDEX community_evidence_reports_review ON community_evidence_reports (review_id);
CREATE INDEX community_evidence_reports_spot ON community_evidence_reports (subject_spot_id) WHERE subject_spot_id IS NOT NULL;

CREATE TRIGGER community_evidence_reports_of_its_artifact
BEFORE INSERT ON community_evidence_reports
WHEN NOT EXISTS (SELECT 1 FROM community_artifact_ledger l WHERE l.artifact_sha256 = NEW.artifact_sha256 AND l.review_id = NEW.review_id)
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_reports: evidence belongs to the review of its own imported artifact');
END;

CREATE TRIGGER community_evidence_reports_immutable
BEFORE UPDATE ON community_evidence_reports
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_reports: imported evidence is immutable');
END;

CREATE TRIGGER community_evidence_reports_no_delete
BEFORE DELETE ON community_evidence_reports
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_reports: imported evidence is never deleted');
END;

-- An application is the imported review itself: same ID, created only together with its ledger row.
CREATE TRIGGER community_applications_from_artifact
BEFORE INSERT ON community_reconciliation_applications
WHEN NOT EXISTS (SELECT 1 FROM community_artifact_ledger l WHERE l.review_id = NEW.application_id AND l.review_kind = 'newSpot'
                   AND l.rule_version = NEW.reconciliation_version)
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_applications: an application is created only by importing its reviewed artifact (ADR-0014)');
END;

CREATE TRIGGER community_effect_applications_from_artifact
BEFORE INSERT ON community_effect_applications
WHEN NOT EXISTS (SELECT 1 FROM community_artifact_ledger l WHERE l.review_id = NEW.application_id AND l.review_kind = 'effect'
                   AND l.rule_version = NEW.effect_version)
BEGIN
  SELECT RAISE(ABORT, 'community_effect_applications: an application is created only by importing its reviewed artifact (ADR-0014)');
END;

CREATE TRIGGER community_absence_applications_from_artifact
BEFORE INSERT ON community_absence_applications
WHEN NOT EXISTS (SELECT 1 FROM community_artifact_ledger l WHERE l.review_id = NEW.application_id AND l.review_kind = 'absence'
                   AND l.rule_version = NEW.review_version)
BEGIN
  SELECT RAISE(ABORT, 'community_absence_applications: an application is created only by importing its reviewed artifact (ADR-0014)');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 4a. New-spot reconciliation (0020, 0023) over sanitized evidence.
DROP TRIGGER community_evidence_report_eligible;
CREATE TRIGGER community_evidence_report_eligible
BEFORE INSERT ON community_reconciliation_evidence
WHEN NOT EXISTS (SELECT 1 FROM community_evidence_reports r
                 WHERE r.report_id = NEW.report_id AND r.review_id = NEW.application_id AND r.report_type = 'missing')
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_evidence: the report is not sanitized new-spot evidence of this application''s artifact');
END;

DROP TRIGGER community_apply_independent_submitters;
CREATE TRIGGER community_apply_independent_submitters
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND COALESCE(NEW.evidence_tier, 'communityVerified') = 'communityVerified' AND NOT EXISTS (
  SELECT 1 FROM community_artifact_ledger l
  WHERE l.review_id = NEW.application_id AND l.evidence_count >= 2 AND l.independent_submitters = l.evidence_count
    AND l.evidence_count = (SELECT count(*) FROM community_reconciliation_evidence e WHERE e.application_id = NEW.application_id))
BEGIN
  SELECT RAISE(ABORT, 'community apply: fewer than two reports from distinct submitters');
END;

DROP TRIGGER community_apply_reported_single_report;
CREATE TRIGGER community_apply_reported_single_report
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND NEW.evidence_tier = 'communityReported' AND NOT EXISTS (
  SELECT 1 FROM community_artifact_ledger l
  WHERE l.review_id = NEW.application_id AND l.evidence_count = 1 AND l.independent_submitters = 1
    AND (SELECT count(*) FROM community_reconciliation_evidence e WHERE e.application_id = NEW.application_id) = 1)
BEGIN
  SELECT RAISE(ABORT, 'community apply: a communityReported application rests on exactly one unredacted report');
END;

DROP TRIGGER community_apply_reported_explicit;
CREATE TRIGGER community_apply_reported_explicit
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND NEW.evidence_tier = 'communityReported' AND EXISTS (
  SELECT 1 FROM community_reconciliation_evidence e LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
  WHERE e.application_id = NEW.application_id
    AND (r.accepted_terms_version IS NULL OR r.claim_spot_type IS NULL OR r.claim_spot_type = 'unknown'))
BEGIN
  SELECT RAISE(ABORT, 'community apply: a communityReported report needs terms consent and an explicit, known spot-type claim');
END;

DROP TRIGGER community_apply_submitter_count;
CREATE TRIGGER community_apply_submitter_count
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND NEW.evidence_tier IS NOT NULL AND NEW.independent_submitters IS NOT (
  SELECT l.independent_submitters FROM community_artifact_ledger l WHERE l.review_id = NEW.application_id)
BEGIN
  SELECT RAISE(ABORT, 'community apply: independent_submitters must equal the distinct submitters of the evidence');
END;

-- Recreated last so it fires first (SQLite runs the newest trigger first): stale evidence stays the first refusal.
DROP TRIGGER community_apply_reports_still_premised;
CREATE TRIGGER community_apply_reports_still_premised
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND EXISTS (
  SELECT 1 FROM community_reconciliation_evidence e
  LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
  WHERE e.application_id = NEW.application_id
    AND (r.report_id IS NULL OR r.usable_until <= substr(NEW.applied_at, 1, 10)))
BEGIN
  SELECT RAISE(ABORT, 'community apply: a linked report is no longer accepted, queued and unredacted');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 4b. Existing-spot effects (0021) over sanitized evidence.
DROP TRIGGER community_effect_evidence_report_eligible;
CREATE TRIGGER community_effect_evidence_report_eligible
BEFORE INSERT ON community_effect_evidence
WHEN NOT EXISTS (SELECT 1 FROM community_evidence_reports r
                 JOIN community_effect_applications a ON a.application_id = NEW.application_id
                 WHERE r.report_id = NEW.report_id AND r.review_id = NEW.application_id
                   AND r.report_type = a.report_type AND r.subject_spot_id = a.subject_spot_id)
BEGIN
  SELECT RAISE(ABORT, 'community_effect_evidence: the report is not sanitized evidence of this type about this spot from this application''s artifact');
END;

DROP TRIGGER community_effect_apply_reports_still_premised;
CREATE TRIGGER community_effect_apply_reports_still_premised
BEFORE UPDATE OF state ON community_effect_applications
WHEN NEW.state = 'applied' AND (
  NOT EXISTS (SELECT 1 FROM community_effect_evidence e WHERE e.application_id = NEW.application_id)
  OR EXISTS (
    SELECT 1 FROM community_effect_evidence e
    LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
    WHERE e.application_id = NEW.application_id
      AND (r.report_id IS NULL OR r.usable_until <= substr(NEW.applied_at, 1, 10))))
BEGIN
  SELECT RAISE(ABORT, 'community effect apply: a linked report is no longer accepted, queued and unredacted');
END;

DROP TRIGGER community_hold_rights;
CREATE TRIGGER community_hold_rights
BEFORE INSERT ON community_publication_holds
WHEN EXISTS (SELECT 1 FROM community_effect_evidence e LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
             WHERE e.application_id = NEW.application_id AND r.accepted_terms_version IS NOT NEW.terms_version)
  OR NOT EXISTS (SELECT 1 FROM report_terms_versions t WHERE t.terms_version = NEW.terms_version AND t.publication_rights = 'granted')
  OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.kind = 'userReport' AND s.publication_status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'community hold: community publication rights do not hold (Issue #124: source approval, granted terms, consent on every report)');
END;

DROP TRIGGER community_hold_evidence_fresh_and_independent;
CREATE TRIGGER community_hold_evidence_fresh_and_independent
BEFORE INSERT ON community_publication_holds
WHEN NOT EXISTS (SELECT 1 FROM community_artifact_ledger l
                 WHERE l.review_id = NEW.application_id AND l.evidence_count >= 2 AND l.independent_submitters = l.evidence_count)
  OR EXISTS (SELECT 1 FROM community_effect_evidence e LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
             WHERE e.application_id = NEW.application_id AND (r.report_id IS NULL OR r.usable_until <= substr(NEW.held_at, 1, 10)))
BEGIN
  SELECT RAISE(ABORT, 'community hold: fewer than two fresh, unredacted reports from distinct submitters');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 4c. communityReported -> communityVerified (0023) over the attested independence of the confirming artifact.
DROP TRIGGER community_evidence_upgrades_consented;
CREATE TRIGGER community_evidence_upgrades_consented
BEFORE INSERT ON community_evidence_upgrades
WHEN EXISTS (SELECT 1 FROM community_effect_evidence e LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
             WHERE e.application_id = NEW.effect_application_id AND r.accepted_terms_version IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_upgrades: a confirming report has no terms consent');
END;

-- The confirming artifact attested independence over exactly the spot's own evidence reports, from as many distinct
-- submitters as the spot carries, and the recorded count is the attested one and exceeds it.
DROP TRIGGER community_evidence_upgrades_independent;
CREATE TRIGGER community_evidence_upgrades_independent
BEFORE INSERT ON community_evidence_upgrades
WHEN NOT EXISTS (
  SELECT 1 FROM community_artifact_ledger l JOIN spots s ON s.spot_id = NEW.spot_id
  WHERE l.review_id = NEW.effect_application_id
    AND l.confirmations_after = NEW.confirmations_after
    AND l.base_independent_submitters = s.community_confirmations
    AND (SELECT count(*) FROM json_each(l.base_report_ids))
      = (SELECT count(*) FROM community_spot_evidence_reports x WHERE x.spot_id = NEW.spot_id)
    AND NOT EXISTS (SELECT 1 FROM community_spot_evidence_reports x WHERE x.spot_id = NEW.spot_id
                      AND x.report_id NOT IN (SELECT value FROM json_each(l.base_report_ids))))
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_upgrades: the confirmation is not independent evidence (same submitter, or a redacted report)');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 4d. Absence review (0024) over sanitized evidence.
DROP TRIGGER community_absence_evidence_report_eligible;
CREATE TRIGGER community_absence_evidence_report_eligible
BEFORE INSERT ON community_absence_evidence
WHEN NOT EXISTS (SELECT 1 FROM community_evidence_reports r
                 JOIN community_absence_applications a ON a.application_id = NEW.application_id
                 WHERE r.report_id = NEW.report_id AND r.review_id = NEW.application_id
                   AND r.report_type = 'other' AND r.finding IN ('notFound', 'removed')
                   AND r.subject_spot_id = a.subject_spot_id)
BEGIN
  SELECT RAISE(ABORT, 'community_absence_evidence: the report is not sanitized notFound/removed evidence about this spot from this application''s artifact');
END;

DROP TRIGGER community_absence_apply_reports_still_premised;
CREATE TRIGGER community_absence_apply_reports_still_premised
BEFORE UPDATE OF state ON community_absence_applications
WHEN NEW.state = 'applied' AND (
  NOT EXISTS (SELECT 1 FROM community_absence_evidence e WHERE e.application_id = NEW.application_id)
  OR EXISTS (
    SELECT 1 FROM community_absence_evidence e
    LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
    WHERE e.application_id = NEW.application_id
      AND (r.report_id IS NULL OR r.usable_until <= substr(NEW.applied_at, 1, 10))))
BEGIN
  SELECT RAISE(ABORT, 'community absence apply: a linked report is no longer accepted, queued and unredacted');
END;

DROP TRIGGER community_absence_hold_rights;
CREATE TRIGGER community_absence_hold_rights
BEFORE INSERT ON community_absence_holds
WHEN EXISTS (SELECT 1 FROM community_absence_evidence e LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
             WHERE e.application_id = NEW.application_id AND r.accepted_terms_version IS NOT NEW.terms_version)
  OR NOT EXISTS (SELECT 1 FROM report_terms_versions t WHERE t.terms_version = NEW.terms_version AND t.publication_rights = 'granted')
  OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.kind = 'userReport' AND s.publication_status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'community absence hold: community publication rights do not hold (Issue #124: source approval, granted terms, consent on every report)');
END;

DROP TRIGGER community_absence_hold_evidence_fresh_and_independent;
CREATE TRIGGER community_absence_hold_evidence_fresh_and_independent
BEFORE INSERT ON community_absence_holds
WHEN NOT EXISTS (SELECT 1 FROM community_artifact_ledger l
                 WHERE l.review_id = NEW.application_id AND l.evidence_count >= 2 AND l.independent_submitters = l.evidence_count)
  OR EXISTS (SELECT 1 FROM community_absence_evidence e LEFT JOIN community_evidence_reports r ON r.report_id = e.report_id
             WHERE e.application_id = NEW.application_id AND (r.report_id IS NULL OR r.usable_until <= substr(NEW.held_at, 1, 10)))
BEGIN
  SELECT RAISE(ABORT, 'community absence hold: fewer than two fresh, unredacted reports from distinct submitters');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Promotion: the ledger and the sanitized evidence are review state of the local pipeline. They never travel in
-- a bundle (only the applied userReport releases do), so a completion refuses a target that holds any of them.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_artifacts_nothing_else
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM community_artifact_ledger) OR EXISTS (SELECT 1 FROM community_evidence_reports)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: a bundle carries no report or community review state');
END;

-- Empty target: both bootstrap guards name every table, now including 0025's (test/promotion-empty-target.test.ts).
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
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstraps)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  OR EXISTS (SELECT 1 FROM cross_source_candidates)
  OR EXISTS (SELECT 1 FROM cross_source_decisions)
  OR EXISTS (SELECT 1 FROM cross_source_merge_applications)
  OR EXISTS (SELECT 1 FROM promotion_cross_source_merge_attestations)
  OR EXISTS (SELECT 1 FROM community_reconciliation_applications)
  OR EXISTS (SELECT 1 FROM community_reconciliation_evidence)
  OR EXISTS (SELECT 1 FROM report_terms_versions)
  OR EXISTS (SELECT 1 FROM community_effect_applications)
  OR EXISTS (SELECT 1 FROM community_effect_evidence)
  OR EXISTS (SELECT 1 FROM community_publication_holds)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases)
  OR EXISTS (SELECT 1 FROM derived_coordinate_geocodes)
  OR EXISTS (SELECT 1 FROM derived_coordinate_reviews)
  OR EXISTS (SELECT 1 FROM community_evidence_upgrades)
  OR EXISTS (SELECT 1 FROM community_absence_applications)
  OR EXISTS (SELECT 1 FROM community_absence_evidence)
  OR EXISTS (SELECT 1 FROM community_absence_holds)
  OR EXISTS (SELECT 1 FROM community_artifact_ledger)
  OR EXISTS (SELECT 1 FROM community_evidence_reports)
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

DROP TRIGGER promotion_multi_bootstraps_empty_target;

CREATE TRIGGER promotion_multi_bootstraps_empty_target
BEFORE INSERT ON promotion_multi_bootstraps
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
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstraps)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  OR EXISTS (SELECT 1 FROM cross_source_candidates)
  OR EXISTS (SELECT 1 FROM cross_source_decisions)
  OR EXISTS (SELECT 1 FROM cross_source_merge_applications)
  OR EXISTS (SELECT 1 FROM promotion_cross_source_merge_attestations)
  OR EXISTS (SELECT 1 FROM community_reconciliation_applications)
  OR EXISTS (SELECT 1 FROM community_reconciliation_evidence)
  OR EXISTS (SELECT 1 FROM report_terms_versions)
  OR EXISTS (SELECT 1 FROM community_effect_applications)
  OR EXISTS (SELECT 1 FROM community_effect_evidence)
  OR EXISTS (SELECT 1 FROM community_publication_holds)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases)
  OR EXISTS (SELECT 1 FROM derived_coordinate_geocodes)
  OR EXISTS (SELECT 1 FROM derived_coordinate_reviews)
  OR EXISTS (SELECT 1 FROM community_evidence_upgrades)
  OR EXISTS (SELECT 1 FROM community_absence_applications)
  OR EXISTS (SELECT 1 FROM community_absence_evidence)
  OR EXISTS (SELECT 1 FROM community_absence_holds)
  OR EXISTS (SELECT 1 FROM community_artifact_ledger)
  OR EXISTS (SELECT 1 FROM community_evidence_reports)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;
