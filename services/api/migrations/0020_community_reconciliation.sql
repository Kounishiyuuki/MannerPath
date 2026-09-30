-- Community report reconciliation (ADR-0007 §2 amendment, NATIONWIDE_DATA_STRATEGY §8, Issue #123).
--
-- The missing step between a queued report and evidence. A reviewer records an immutable APPLICATION: a
-- new-spot claim backed by explicit accepted, queued `missing` reports from at least two distinct submitters,
-- at the pin of one of those reports (never a computed coordinate). Applying it writes one sanitized,
-- single-record release of the reviewed `userReport` source (src/pipeline/community-adapter.ts) and resolves it
-- through the ordinary resolver, in ONE D1 batch with the application and its reports moving to `applied`.
--
-- This file holds no personal content: an application stores report IDs (the ADR-0007 §4 non-personal skeleton)
-- and a reviewer handle. The coordinate enters the database only in the applied release's record, copied from
-- the adopted report's pin at apply time; note, submitter hash, observed date and attestation are never copied.
--
-- Each guard is its own small trigger (0018/0019: one large trigger exceeded D1's expression depth limit).

CREATE TABLE community_reconciliation_applications (
  application_id         TEXT PRIMARY KEY CHECK (length(application_id) = 29 AND application_id GLOB 'ca_[0-9A-HJKMNP-TV-Z]*'),
  -- Only new-spot proposals (report type `missing`) are reconciled by v1.
  claim_type             TEXT NOT NULL CHECK (claim_type = 'newSpot'),
  -- The report whose proposed pin the reviewer adopts as the spot's location. Averaging is not a decision.
  location_report_id     TEXT NOT NULL CHECK (length(location_report_id) = 29 AND location_report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*'),
  reconciliation_version TEXT NOT NULL CHECK (reconciliation_version = 'community-reconciliation.v1'),
  -- A reviewer handle, never an end user, never free text about the report.
  decided_by             TEXT NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 64),
  decided_at             TEXT NOT NULL,
  state                  TEXT NOT NULL CHECK (state IN ('proposed', 'applied', 'withdrawn')),
  release_id             INTEGER UNIQUE REFERENCES source_releases (release_id),
  applied_at             TEXT,
  withdrawn_at           TEXT,
  CHECK ((state = 'applied') = (release_id IS NOT NULL)),
  CHECK ((state = 'applied') = (applied_at IS NOT NULL)),
  CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);

-- A report backs at most one application, ever: the primary key is the report. A withdrawn application keeps its
-- reports, so a superseded decision can never be re-used silently under a new one.
CREATE TABLE community_reconciliation_evidence (
  report_id      TEXT PRIMARY KEY CHECK (length(report_id) = 29 AND report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*'),
  application_id TEXT NOT NULL REFERENCES community_reconciliation_applications (application_id)
);

CREATE INDEX community_reconciliation_evidence_application ON community_reconciliation_evidence (application_id);

CREATE TRIGGER community_applications_born_proposed
BEFORE INSERT ON community_reconciliation_applications
WHEN NEW.state <> 'proposed'
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_applications: an application is born proposed');
END;

CREATE TRIGGER community_applications_decision_immutable
BEFORE UPDATE ON community_reconciliation_applications
WHEN NEW.application_id IS NOT OLD.application_id OR NEW.claim_type IS NOT OLD.claim_type
  OR NEW.location_report_id IS NOT OLD.location_report_id OR NEW.reconciliation_version IS NOT OLD.reconciliation_version
  OR NEW.decided_by IS NOT OLD.decided_by OR NEW.decided_at IS NOT OLD.decided_at
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_applications: a reviewed decision is immutable');
END;

-- proposed -> applied | withdrawn, once. Applied and withdrawn are terminal.
CREATE TRIGGER community_applications_one_way
BEFORE UPDATE ON community_reconciliation_applications
WHEN NOT (OLD.state = 'proposed' AND NEW.state IN ('applied', 'withdrawn'))
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_applications: only proposed -> applied or proposed -> withdrawn');
END;

CREATE TRIGGER community_applications_no_delete
BEFORE DELETE ON community_reconciliation_applications
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_applications: applications are never deleted');
END;

-- Linking: only to a proposed application, only a report that is a new-spot proposal with its pin, accepted,
-- queued and not redacted.
CREATE TRIGGER community_evidence_application_proposed
BEFORE INSERT ON community_reconciliation_evidence
WHEN NOT EXISTS (SELECT 1 FROM community_reconciliation_applications a
                 WHERE a.application_id = NEW.application_id AND a.state = 'proposed')
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_evidence: the application is not proposed');
END;

CREATE TRIGGER community_evidence_report_eligible
BEFORE INSERT ON community_reconciliation_evidence
WHEN NOT EXISTS (SELECT 1 FROM reports r JOIN report_moderation m ON m.report_id = r.report_id
                 WHERE r.report_id = NEW.report_id AND r.report_type = 'missing' AND r.redacted_at IS NULL
                   AND r.proposed_latitude IS NOT NULL AND m.state = 'accepted' AND m.reconciliation_state = 'queued')
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_evidence: the report is not an accepted, queued, unredacted missing-spot proposal');
END;

CREATE TRIGGER community_evidence_immutable
BEFORE UPDATE ON community_reconciliation_evidence
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_evidence: evidence links are immutable');
END;

CREATE TRIGGER community_evidence_no_delete
BEFORE DELETE ON community_reconciliation_evidence
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_evidence: evidence links are never deleted');
END;

-- Apply premises, re-checked inside the apply batch (the application UPDATE is its first statement).
-- 1. Every linked report is still accepted, queued, unredacted and inside its minimization window.
CREATE TRIGGER community_apply_reports_still_premised
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND EXISTS (
  SELECT 1 FROM community_reconciliation_evidence e
  LEFT JOIN reports r ON r.report_id = e.report_id
  LEFT JOIN report_moderation m ON m.report_id = e.report_id
  WHERE e.application_id = NEW.application_id
    AND (r.report_id IS NULL OR r.redacted_at IS NOT NULL OR r.minimize_after <= NEW.applied_at
      OR m.state IS NOT 'accepted' OR m.reconciliation_state IS NOT 'queued'))
BEGIN
  SELECT RAISE(ABORT, 'community apply: a linked report is no longer accepted, queued and unredacted');
END;

-- 2. Corroboration: at least two reports, one per distinct submitter. The hash is compared here and never copied.
CREATE TRIGGER community_apply_independent_submitters
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND (
  SELECT count(*) < 2 OR count(DISTINCT r.submitter_hash) <> count(*) OR count(r.submitter_hash) <> count(*)
  FROM community_reconciliation_evidence e LEFT JOIN reports r ON r.report_id = e.report_id
  WHERE e.application_id = NEW.application_id)
BEGIN
  SELECT RAISE(ABORT, 'community apply: fewer than two reports from distinct submitters');
END;

-- 3. The adopted pin is one of the application's own reports.
CREATE TRIGGER community_apply_location_is_evidence
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND NOT EXISTS (
  SELECT 1 FROM community_reconciliation_evidence e
  WHERE e.application_id = NEW.application_id AND e.report_id = NEW.location_report_id)
BEGIN
  SELECT RAISE(ABORT, 'community apply: the adopted location is not one of the application''s reports');
END;

-- 4. The release is an ingested, single-record release of a userReport source whose record is this application.
CREATE TRIGGER community_apply_release_is_this_application
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND NOT EXISTS (
  SELECT 1 FROM source_releases rel
  JOIN sources s ON s.source_id = rel.source_id AND s.kind = 'userReport'
  JOIN source_records rec ON rec.release_id = rel.release_id AND rec.ordinal = 1
  WHERE rel.release_id = NEW.release_id AND rel.status = 'ingested' AND rel.record_count = 1
    AND rec.upstream_row_ref = NEW.application_id)
BEGIN
  SELECT RAISE(ABORT, 'community apply: the release is not the ingested single-record release of this application');
END;

-- A userReport release becomes applied only as the release of an applied application (set earlier in the same
-- batch), so no code path can resolve user-derived evidence around the review. It is never `current`: each
-- application is its own additive release and none describes the whole source.
CREATE TRIGGER community_release_applied_only_by_application
BEFORE UPDATE OF status ON source_releases
WHEN NEW.status = 'applied' AND OLD.status <> 'applied'
  AND (SELECT kind FROM sources WHERE source_id = NEW.source_id) = 'userReport'
  AND NOT EXISTS (SELECT 1 FROM community_reconciliation_applications a
                  WHERE a.release_id = NEW.release_id AND a.state = 'applied')
BEGIN
  SELECT RAISE(ABORT, 'source_releases: a userReport release is applied only by its applied reconciliation application');
END;

CREATE TRIGGER community_release_never_current
BEFORE UPDATE OF is_current ON source_releases
WHEN NEW.is_current = 1 AND (SELECT kind FROM sources WHERE source_id = NEW.source_id) = 'userReport'
BEGIN
  SELECT RAISE(ABORT, 'source_releases: a userReport release is additive and never current');
END;

-- Reconciliation state machine (0003), now with the one transition this slice can honestly make:
-- queued -> applied, only for a report linked to an applied application (set earlier in the same batch).
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
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: illegal reconciliation transition (allowed: notQueued->queued, notQueued->discarded, queued->discarded, queued->applied only through an applied community reconciliation application)');
END;

-- Cross-source recall (0019) reads a spot's evidence from its source's current release. A userReport source is
-- additive — every applied release is live evidence and none is current — so for that kind an applied release
-- counts. Everything else in the definition is unchanged.
DROP VIEW cross_source_spot_sources;

CREATE VIEW cross_source_spot_sources AS
SELECT s.spot_id, rel.source_id, p.record_id, rel.release_id, l.source_entity_id
FROM spots s
JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
JOIN source_records r ON r.record_id = p.record_id
JOIN source_releases rel ON rel.release_id = r.release_id AND rel.status = 'applied'
JOIN sources src ON src.source_id = rel.source_id AND src.publication_status = 'approved'
  AND (rel.is_current = 1 OR src.kind = 'userReport')
JOIN spot_source_entities l ON l.spot_id = s.spot_id
JOIN source_entities e ON e.source_entity_id = l.source_entity_id AND e.source_id = rel.source_id
WHERE (SELECT count(*) FROM spot_source_entities x WHERE x.spot_id = s.spot_id) = 1;

-- Empty target: both bootstrap guards name every table, now including 0020's (test/promotion-empty-target.test.ts).
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
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;
