-- Community acquisition engine (ADR-0013, Issue #67 child). ADR-0012 made lower-confidence community data technically
-- publishable; this migration adds what a nationwide collection channel needs on top of it. Issue #124 stays open:
-- the community source stays `blocked` and the draft terms stay `pending`, so nothing here publishes user data today.
--
-- 1. Structured existing-spot findings. `reports.report_type` keeps its populated 0003 CHECK (SQLite cannot widen
--    it); the new negative and correction findings are stored as report_type `other` plus a closed `finding`:
--      notFound   "I looked and could not find it"          (negative evidence, weak)
--      removed    "it has been removed"                     (negative evidence)
--      wrongType  "it is a different kind of place"         (a correction; may carry the proposed spot type)
--    A finding is a categorical fact about a place, not about a person: it is part of the immutable proposal and
--    survives redaction, like the ADR-0012 claims.
-- 2. Correction claims on existing-spot reports: a `wrongType` finding may state the proposed spot type/subtype, an
--    `accessChanged` report the proposed access, a `tobaccoTypeChanged` report the proposed tobacco support. Still a
--    proposal: no canonical field is ever written from a report (community-effects.ts).
-- 3. Absence review (negative evidence). Accepted, queued notFound/removed reports about one published spot back an
--    immutable reviewed ABSENCE application. Applying it records a review candidate only. The one public-facing
--    effect — withholding the spot — is a separate explicit hold that the database refuses unless two independent
--    submitters, fresh unredacted evidence and the community rights (Issue #124) all hold. One negative report never
--    removes anything; stale is never removed (ADR-0012 decision 4). An official closure goes through the existing
--    source-release removal machinery (ADR-0006/0009), not through here.
--
-- Nothing personal is added: applications store report IDs, a spot ID and a reviewer handle.
-- Each guard is its own small trigger (0018/0019: one large trigger exceeded D1's expression depth limit).

-- ---------------------------------------------------------------------------------------------------------
-- 1. Findings.
ALTER TABLE reports ADD COLUMN finding TEXT CHECK (finding IS NULL OR finding IN ('notFound', 'removed', 'wrongType'));

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

-- ---------------------------------------------------------------------------------------------------------
-- 2. Which claims each report may carry (replaces 0023's missing-only rule). Free text stays new-spot only.
DROP TRIGGER reports_claims_only_on_missing;

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
-- 3. Absence review.
CREATE TABLE community_absence_applications (
  application_id  TEXT PRIMARY KEY CHECK (length(application_id) = 29 AND application_id GLOB 'cn_[0-9A-HJKMNP-TV-Z]*'),
  subject_spot_id TEXT NOT NULL CHECK (length(subject_spot_id) = 29 AND subject_spot_id GLOB 'sp_[0-9A-HJKMNP-TV-Z]*'),
  review_version  TEXT NOT NULL CHECK (review_version = 'community-absence.v1'),
  decided_by      TEXT NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 64),
  decided_at      TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('proposed', 'applied', 'withdrawn')),
  applied_at      TEXT,
  withdrawn_at    TEXT,
  CHECK ((state = 'applied') = (applied_at IS NOT NULL)),
  CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);

CREATE INDEX community_absence_applications_spot ON community_absence_applications (subject_spot_id);

CREATE TABLE community_absence_evidence (
  report_id      TEXT PRIMARY KEY CHECK (length(report_id) = 29 AND report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*'),
  application_id TEXT NOT NULL REFERENCES community_absence_applications (application_id)
);

CREATE INDEX community_absence_evidence_application ON community_absence_evidence (application_id);

CREATE TRIGGER community_absence_applications_born_proposed
BEFORE INSERT ON community_absence_applications
WHEN NEW.state <> 'proposed'
BEGIN
  SELECT RAISE(ABORT, 'community_absence_applications: an application is born proposed');
END;

CREATE TRIGGER community_absence_applications_decision_immutable
BEFORE UPDATE ON community_absence_applications
WHEN NEW.application_id IS NOT OLD.application_id OR NEW.subject_spot_id IS NOT OLD.subject_spot_id
  OR NEW.review_version IS NOT OLD.review_version OR NEW.decided_by IS NOT OLD.decided_by OR NEW.decided_at IS NOT OLD.decided_at
BEGIN
  SELECT RAISE(ABORT, 'community_absence_applications: a reviewed decision is immutable');
END;

CREATE TRIGGER community_absence_applications_one_way
BEFORE UPDATE ON community_absence_applications
WHEN NOT (OLD.state = 'proposed' AND NEW.state IN ('applied', 'withdrawn'))
BEGIN
  SELECT RAISE(ABORT, 'community_absence_applications: only proposed -> applied or proposed -> withdrawn');
END;

CREATE TRIGGER community_absence_applications_no_delete
BEFORE DELETE ON community_absence_applications
BEGIN
  SELECT RAISE(ABORT, 'community_absence_applications: applications are never deleted');
END;

CREATE TRIGGER community_absence_evidence_application_proposed
BEFORE INSERT ON community_absence_evidence
WHEN NOT EXISTS (SELECT 1 FROM community_absence_applications a
                 WHERE a.application_id = NEW.application_id AND a.state = 'proposed')
BEGIN
  SELECT RAISE(ABORT, 'community_absence_evidence: the application is not proposed');
END;

CREATE TRIGGER community_absence_evidence_report_eligible
BEFORE INSERT ON community_absence_evidence
WHEN NOT EXISTS (SELECT 1 FROM reports r
                 JOIN report_moderation m ON m.report_id = r.report_id
                 JOIN community_absence_applications a ON a.application_id = NEW.application_id
                 WHERE r.report_id = NEW.report_id AND r.redacted_at IS NULL
                   AND r.report_type = 'other' AND r.finding IN ('notFound', 'removed')
                   AND r.subject_spot_id = a.subject_spot_id
                   AND m.state = 'accepted' AND m.reconciliation_state = 'queued')
BEGIN
  SELECT RAISE(ABORT, 'community_absence_evidence: the report is not an accepted, queued, unredacted notFound/removed report about this spot');
END;

CREATE TRIGGER community_absence_evidence_immutable
BEFORE UPDATE ON community_absence_evidence
BEGIN
  SELECT RAISE(ABORT, 'community_absence_evidence: evidence links are immutable');
END;

CREATE TRIGGER community_absence_evidence_no_delete
BEFORE DELETE ON community_absence_evidence
BEGIN
  SELECT RAISE(ABORT, 'community_absence_evidence: evidence links are never deleted');
END;

CREATE TRIGGER community_absence_apply_reports_still_premised
BEFORE UPDATE OF state ON community_absence_applications
WHEN NEW.state = 'applied' AND (
  NOT EXISTS (SELECT 1 FROM community_absence_evidence e WHERE e.application_id = NEW.application_id)
  OR EXISTS (
    SELECT 1 FROM community_absence_evidence e
    LEFT JOIN reports r ON r.report_id = e.report_id
    LEFT JOIN report_moderation m ON m.report_id = e.report_id
    WHERE e.application_id = NEW.application_id
      AND (r.report_id IS NULL OR r.redacted_at IS NOT NULL OR r.minimize_after <= NEW.applied_at
        OR m.state IS NOT 'accepted' OR m.reconciliation_state IS NOT 'queued')))
BEGIN
  SELECT RAISE(ABORT, 'community absence apply: a linked report is no longer accepted, queued and unredacted');
END;

-- Reconciliation state machine (0003, 0020, 0021), plus: queued -> applied for a report linked to an applied absence
-- application (set earlier in the same batch).
DROP TRIGGER report_moderation_reconciliation_transitions;

CREATE TRIGGER report_moderation_reconciliation_transitions
BEFORE UPDATE OF reconciliation_state ON report_moderation
WHEN NEW.reconciliation_state <> OLD.reconciliation_state
  AND NOT (OLD.reconciliation_state = 'notQueued' AND NEW.reconciliation_state IN ('queued', 'discarded'))
  AND NOT (OLD.reconciliation_state = 'queued' AND NEW.reconciliation_state = 'discarded')
  AND NOT (OLD.reconciliation_state = 'queued' AND NEW.reconciliation_state = 'applied'
    AND EXISTS (SELECT 1 FROM community_reconciliation_evidence e
                JOIN community_reconciliation_applications a ON a.application_id = e.application_id
                WHERE e.report_id = NEW.report_id AND a.state = 'applied'))
  AND NOT (OLD.reconciliation_state = 'queued' AND NEW.reconciliation_state = 'applied'
    AND EXISTS (SELECT 1 FROM community_effect_evidence e
                JOIN community_effect_applications a ON a.application_id = e.application_id
                WHERE e.report_id = NEW.report_id AND a.state = 'applied'))
  AND NOT (OLD.reconciliation_state = 'queued' AND NEW.reconciliation_state = 'applied'
    AND EXISTS (SELECT 1 FROM community_absence_evidence e
                JOIN community_absence_applications a ON a.application_id = e.application_id
                WHERE e.report_id = NEW.report_id AND a.state = 'applied'))
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: illegal reconciliation transition (allowed: notQueued->queued, notQueued->discarded, queued->discarded, queued->applied only through an applied community application)');
END;

-- The publication hold of an applied absence review. Append-only; lifted once by a reviewed lift.
CREATE TABLE community_absence_holds (
  application_id   TEXT PRIMARY KEY REFERENCES community_absence_applications (application_id),
  spot_id          TEXT NOT NULL REFERENCES spots (spot_id),
  executor_version TEXT NOT NULL CHECK (executor_version = 'community-absence-hold.v1'),
  terms_version    TEXT NOT NULL,
  held_at          TEXT NOT NULL,
  lifted_at        TEXT,
  lifted_by        TEXT CHECK (lifted_by IS NULL OR length(lifted_by) BETWEEN 1 AND 64),
  CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
);

CREATE UNIQUE INDEX community_absence_holds_one_active ON community_absence_holds (spot_id) WHERE lifted_at IS NULL;

CREATE TRIGGER community_absence_hold_application_applied
BEFORE INSERT ON community_absence_holds
WHEN NOT EXISTS (SELECT 1 FROM community_absence_applications a
                 WHERE a.application_id = NEW.application_id AND a.state = 'applied' AND a.subject_spot_id = NEW.spot_id)
  OR EXISTS (SELECT 1 FROM tile_snapshot_spots t WHERE t.spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'community absence hold: not an applied absence review of this unpublished spot');
END;

CREATE TRIGGER community_absence_hold_evidence_fresh_and_independent
BEFORE INSERT ON community_absence_holds
WHEN (SELECT count(*) < 2 OR count(DISTINCT r.submitter_hash) <> count(*) OR count(r.submitter_hash) <> count(*)
        OR sum(CASE WHEN r.redacted_at IS NULL AND r.minimize_after > NEW.held_at THEN 0 ELSE 1 END) > 0
      FROM community_absence_evidence e LEFT JOIN reports r ON r.report_id = e.report_id
      WHERE e.application_id = NEW.application_id)
BEGIN
  SELECT RAISE(ABORT, 'community absence hold: fewer than two fresh, unredacted reports from distinct submitters');
END;

CREATE TRIGGER community_absence_hold_rights
BEFORE INSERT ON community_absence_holds
WHEN EXISTS (SELECT 1 FROM community_absence_evidence e LEFT JOIN reports r ON r.report_id = e.report_id
             WHERE e.application_id = NEW.application_id AND r.accepted_terms_version IS NOT NEW.terms_version)
  OR NOT EXISTS (SELECT 1 FROM report_terms_versions t WHERE t.terms_version = NEW.terms_version AND t.publication_rights = 'granted')
  OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.kind = 'userReport' AND s.publication_status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'community absence hold: community publication rights do not hold (Issue #124: source approval, granted terms, consent on every report)');
END;

CREATE TRIGGER community_absence_holds_lift_only
BEFORE UPDATE ON community_absence_holds
WHEN NEW.application_id IS NOT OLD.application_id OR NEW.spot_id IS NOT OLD.spot_id
  OR NEW.executor_version IS NOT OLD.executor_version OR NEW.terms_version IS NOT OLD.terms_version
  OR NEW.held_at IS NOT OLD.held_at OR OLD.lifted_at IS NOT NULL OR NEW.lifted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'community_absence_holds: the only update is one reviewed lift');
END;

CREATE TRIGGER community_absence_holds_no_delete
BEFORE DELETE ON community_absence_holds
BEGIN
  SELECT RAISE(ABORT, 'community_absence_holds: holds are never deleted; lift them');
END;

CREATE TRIGGER tile_snapshot_spots_community_absence_hold
BEFORE INSERT ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM community_absence_holds h WHERE h.spot_id = NEW.spot_id AND h.lifted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: the spot is held by a reviewed community absence review');
END;

-- Completion: the runtime community state never travels (0021), now including the absence review.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_absence_nothing_else
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM community_absence_applications) OR EXISTS (SELECT 1 FROM community_absence_evidence)
  OR EXISTS (SELECT 1 FROM community_absence_holds)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: a bundle carries no report or community review state');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Empty target: both bootstrap guards name every table, now including 0024's (test/promotion-empty-target.test.ts).
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
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

