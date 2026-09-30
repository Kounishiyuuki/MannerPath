-- Coverage-first multi-confidence listing model (ADR-0012, Issue #67 child).
--
-- ADR-0012 stops expressing trust as "published or not". A published spot now carries separate, explicit axes —
-- existence evidence, location precision, review freshness, access and spot taxonomy — and a moderated single
-- community report may become a visible `communityReported` spot once its rights basis is granted (Issue #124 is
-- still open: the community source stays `blocked` and the draft terms stay `pending`, so nothing here publishes
-- user-derived data today).
--
-- 1. Structured new-spot claims on the report itself. The categorical claims (spot type, subtype, access, host
--    type, environment, tobacco support) describe a place, not a person: they are part of the immutable proposal
--    and survive redaction. The two free-text claims (a host name, an hours note) are personal content like
--    `note`: they are minimized with it after 90 days (ADR-0007 §4) and are never copied anywhere.
-- 2. Evidence tiers on community reconciliation: a reviewer may apply ONE accepted, consented, explicitly
--    classified report as `communityReported`; `communityVerified` still needs two independent submitters. The
--    number of independent submitters is recorded at apply time as a count — the hashes are compared, never copied.
-- 3. communityReported -> communityVerified upgrades through an applied `exists` effect from an independent
--    submitter. The database checks independence while every hash involved still exists.
-- 4. Spot columns the multi-confidence DTO needs: a taxonomy refinement (`spot_subtype`), an access refinement
--    (`access_detail`), the independent confirmation count and the non-personal review day of a community spot.
--    SQLite cannot widen the spot_type/access_type CHECKs of a populated table (0002), so the v1 vocabularies stay
--    exactly as they are and the refinements are separate, nullable columns; `host_type` gains a vocabulary.
--
-- Each guard is its own small trigger (0018/0019: one large trigger exceeded D1's expression depth limit).

-- ---------------------------------------------------------------------------------------------------------
-- 1. Structured claims on a new-spot (`missing`) report.

ALTER TABLE reports ADD COLUMN claim_spot_type TEXT
  CHECK (claim_spot_type IS NULL OR claim_spot_type IN (
    'designatedOutdoorArea', 'publicSmokingRoom', 'facilitySmokingRoom', 'ashtray', 'smokingPermittedVenue', 'unknown'));
ALTER TABLE reports ADD COLUMN claim_spot_subtype TEXT
  CHECK (claim_spot_subtype IS NULL OR claim_spot_subtype IN ('smokingCorner', 'tobaccoShopSmokingSpace'));
ALTER TABLE reports ADD COLUMN claim_access_type TEXT
  CHECK (claim_access_type IS NULL OR claim_access_type IN ('public', 'customerOnly', 'facilityOnly', 'unknown'));
ALTER TABLE reports ADD COLUMN claim_access_detail TEXT
  CHECK (claim_access_detail IS NULL OR claim_access_detail IN ('ticketedUsersOnly'));
ALTER TABLE reports ADD COLUMN claim_host_type TEXT
  CHECK (claim_host_type IS NULL OR claim_host_type IN (
    'municipality', 'station', 'airport', 'commercialBuilding', 'convenienceStore', 'tobaccoShop', 'restaurantOrCafe', 'other', 'unknown'));
ALTER TABLE reports ADD COLUMN claim_environment TEXT
  CHECK (claim_environment IS NULL OR claim_environment IN ('indoor', 'outdoor', 'covered', 'unknown'));
ALTER TABLE reports ADD COLUMN claim_supports_paper TEXT
  CHECK (claim_supports_paper IS NULL OR claim_supports_paper IN ('yes', 'no', 'unknown'));
ALTER TABLE reports ADD COLUMN claim_supports_heated TEXT
  CHECK (claim_supports_heated IS NULL OR claim_supports_heated IN ('yes', 'no', 'unknown'));
-- Personal free text (ADR-0007 §4): redacted with `note`, never copied into evidence.
ALTER TABLE reports ADD COLUMN claim_host_name TEXT CHECK (claim_host_name IS NULL OR length(claim_host_name) BETWEEN 1 AND 80);
ALTER TABLE reports ADD COLUMN claim_hours_note TEXT CHECK (claim_hours_note IS NULL OR length(claim_hours_note) BETWEEN 1 AND 120);

-- Claims exist only on a new-spot proposal, and a subtype/detail only refines the value it belongs to.
CREATE TRIGGER reports_claims_only_on_missing
BEFORE INSERT ON reports
WHEN NEW.report_type <> 'missing' AND (NEW.claim_spot_type IS NOT NULL OR NEW.claim_spot_subtype IS NOT NULL
  OR NEW.claim_access_type IS NOT NULL OR NEW.claim_access_detail IS NOT NULL OR NEW.claim_host_type IS NOT NULL
  OR NEW.claim_environment IS NOT NULL OR NEW.claim_supports_paper IS NOT NULL OR NEW.claim_supports_heated IS NOT NULL
  OR NEW.claim_host_name IS NOT NULL OR NEW.claim_hours_note IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'reports: structured claims are accepted only on a missing (new-spot) report');
END;

CREATE TRIGGER reports_claim_refinements_consistent
BEFORE INSERT ON reports
WHEN (NEW.claim_spot_subtype IS NOT NULL AND NEW.claim_spot_type IS NULL)
  OR (NEW.claim_access_detail IS NOT NULL AND NEW.claim_access_type IS NOT 'facilityOnly')
BEGIN
  SELECT RAISE(ABORT, 'reports: a spot subtype needs a spot type, and ticketedUsersOnly refines facilityOnly');
END;

-- As in 0021, plus the claims: the categorical claims are immutable; the free-text claims may only become NULL
-- by redaction.
DROP TRIGGER reports_only_redaction_updates;
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

-- A redacted row keeps no free text, as the 0003 table CHECK already demands for `note`.
CREATE TRIGGER reports_redaction_clears_claim_text
BEFORE UPDATE ON reports
WHEN NEW.redacted_at IS NOT NULL AND (NEW.claim_host_name IS NOT NULL OR NEW.claim_hours_note IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'reports: redaction clears the free-text claims together with the other personal content');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Evidence tiers on community reconciliation.

-- NULL on every application proposed before this migration: those needed two independent submitters, so they read
-- as communityVerified. `reconciliation_version` stays 'community-reconciliation.v1' (its 0020 CHECK is fixed); the
-- tier rule is versioned here instead.
ALTER TABLE community_reconciliation_applications ADD COLUMN evidence_tier TEXT
  CHECK (evidence_tier IS NULL OR evidence_tier IN ('communityReported', 'communityVerified'));
ALTER TABLE community_reconciliation_applications ADD COLUMN tier_rule_version TEXT
  CHECK (tier_rule_version IS NULL OR tier_rule_version = 'community-tiers.v1');
-- Set at apply time and re-checked there; a count, never a hash.
ALTER TABLE community_reconciliation_applications ADD COLUMN independent_submitters INTEGER
  CHECK (independent_submitters IS NULL OR independent_submitters >= 1);

CREATE TRIGGER community_applications_tier_declared
BEFORE INSERT ON community_reconciliation_applications
WHEN (NEW.evidence_tier IS NULL) <> (NEW.tier_rule_version IS NULL) OR NEW.independent_submitters IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_applications: a tier is declared with its rule version, and the submitter count is set only at apply');
END;

-- Only a proposed row can change at all (0020 community_applications_one_way); this narrows what that change may do.
CREATE TRIGGER community_applications_tier_immutable
BEFORE UPDATE ON community_reconciliation_applications
WHEN OLD.state = 'proposed' AND (NEW.evidence_tier IS NOT OLD.evidence_tier OR NEW.tier_rule_version IS NOT OLD.tier_rule_version
  OR (OLD.independent_submitters IS NOT NULL AND NEW.independent_submitters IS NOT OLD.independent_submitters)
  OR (NEW.state <> 'applied' AND NEW.independent_submitters IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'community_reconciliation_applications: the tier is part of the decision, and the count is written once, at apply');
END;

-- Corroboration now depends on the tier. communityVerified (and every legacy application): at least two reports,
-- one per distinct submitter. communityReported: exactly one report, with its submitter key still present.
DROP TRIGGER community_apply_independent_submitters;
CREATE TRIGGER community_apply_independent_submitters
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND COALESCE(NEW.evidence_tier, 'communityVerified') = 'communityVerified' AND (
  SELECT count(*) < 2 OR count(DISTINCT r.submitter_hash) <> count(*) OR count(r.submitter_hash) <> count(*)
  FROM community_reconciliation_evidence e LEFT JOIN reports r ON r.report_id = e.report_id
  WHERE e.application_id = NEW.application_id)
BEGIN
  SELECT RAISE(ABORT, 'community apply: fewer than two reports from distinct submitters');
END;

CREATE TRIGGER community_apply_reported_single_report
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND NEW.evidence_tier = 'communityReported' AND (
  SELECT count(*) <> 1 OR count(r.submitter_hash) <> 1
  FROM community_reconciliation_evidence e LEFT JOIN reports r ON r.report_id = e.report_id
  WHERE e.application_id = NEW.application_id)
BEGIN
  SELECT RAISE(ABORT, 'community apply: a communityReported application rests on exactly one unredacted report');
END;

-- A single report carries no corroboration, so it must carry everything else explicitly: consent to the report
-- terms (the rights basis, Issue #124) and a stated, known spot type — an ashtray, a room, a permitted venue. A host
-- business alone (a convenience store, a café) is not a smoking place, and a place is never classified for the
-- reporter.
CREATE TRIGGER community_apply_reported_explicit
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND NEW.evidence_tier = 'communityReported' AND EXISTS (
  SELECT 1 FROM community_reconciliation_evidence e LEFT JOIN reports r ON r.report_id = e.report_id
  WHERE e.application_id = NEW.application_id
    AND (r.accepted_terms_version IS NULL OR r.claim_spot_type IS NULL OR r.claim_spot_type = 'unknown'))
BEGIN
  SELECT RAISE(ABORT, 'community apply: a communityReported report needs terms consent and an explicit, known spot-type claim');
END;

-- The recorded count is exactly the number of distinct submitter keys behind the application.
CREATE TRIGGER community_apply_submitter_count
BEFORE UPDATE OF state ON community_reconciliation_applications
WHEN NEW.state = 'applied' AND NEW.evidence_tier IS NOT NULL AND NEW.independent_submitters IS NOT (
  SELECT count(DISTINCT r.submitter_hash)
  FROM community_reconciliation_evidence e JOIN reports r ON r.report_id = e.report_id
  WHERE e.application_id = NEW.application_id)
BEGIN
  SELECT RAISE(ABORT, 'community apply: independent_submitters must equal the distinct submitters of the evidence');
END;

-- Recreated unchanged from 0020 so it fires before the tier checks above (SQLite runs the newest trigger first):
-- a stale report stays the first, most specific refusal.
DROP TRIGGER community_apply_reports_still_premised;
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

-- ---------------------------------------------------------------------------------------------------------
-- 4. Spot columns (before 3, whose guards read them).

ALTER TABLE spots ADD COLUMN spot_subtype TEXT
  CHECK (spot_subtype IS NULL OR spot_subtype IN ('smokingCorner', 'tobaccoShopSmokingSpace'));
ALTER TABLE spots ADD COLUMN access_detail TEXT
  CHECK (access_detail IS NULL OR access_detail IN ('ticketedUsersOnly'));
-- Community spots only: independent submitters behind the existence evidence, and the day the reviewed evidence
-- was last applied (a reviewer action, not a personal observation; published at month precision only).
ALTER TABLE spots ADD COLUMN community_confirmations INTEGER
  CHECK (community_confirmations IS NULL OR community_confirmations >= 1);
ALTER TABLE spots ADD COLUMN last_reviewed_on TEXT
  CHECK (last_reviewed_on IS NULL OR (last_reviewed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
    AND last_reviewed_on IS date(last_reviewed_on)));

CREATE TRIGGER spots_host_type_vocabulary
BEFORE INSERT ON spots
WHEN NEW.host_type IS NOT NULL AND NEW.host_type NOT IN (
  'municipality', 'station', 'airport', 'commercialBuilding', 'convenienceStore', 'tobaccoShop', 'restaurantOrCafe', 'other', 'unknown')
BEGIN
  SELECT RAISE(ABORT, 'spots: host_type outside the public vocabulary');
END;

CREATE TRIGGER spots_refinements_consistent
BEFORE INSERT ON spots
WHEN (NEW.access_detail IS NOT NULL AND NEW.access_type <> 'facilityOnly')
  OR (NEW.spot_subtype = 'tobaccoShopSmokingSpace' AND NEW.spot_type NOT IN ('smokingPermittedVenue', 'facilitySmokingRoom', 'ashtray'))
  OR (NEW.spot_subtype = 'smokingCorner' AND NEW.spot_type NOT IN ('designatedOutdoorArea', 'facilitySmokingRoom', 'ashtray'))
BEGIN
  SELECT RAISE(ABORT, 'spots: a subtype or access detail must refine a compatible v1 value');
END;

-- The normalized observation carries what the record states about the place and, for a community record, its tier
-- and confirmation count (src/pipeline/observe.ts). NULL for every record that states none of it — every official
-- record so far — so their observations are unchanged.
ALTER TABLE source_observations ADD COLUMN claims_json TEXT
  CHECK (claims_json IS NULL OR (json_valid(claims_json) AND json_type(claims_json) = 'object'));

-- ---------------------------------------------------------------------------------------------------------
-- 3. communityReported -> communityVerified.

CREATE TABLE community_evidence_upgrades (
  spot_id               TEXT PRIMARY KEY CHECK (length(spot_id) = 29 AND spot_id GLOB 'sp_[0-9A-HJKMNP-TV-Z]*'),
  -- The applied `exists` effect whose reports confirm the spot. One effect upgrades at most one spot.
  effect_application_id TEXT NOT NULL UNIQUE REFERENCES community_effect_applications (application_id),
  upgrade_version       TEXT NOT NULL CHECK (upgrade_version = 'community-verification.v1'),
  -- Distinct submitters behind the spot after the upgrade (original evidence plus confirmations).
  confirmations_after   INTEGER NOT NULL CHECK (confirmations_after >= 2),
  decided_by            TEXT NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 64),
  applied_at            TEXT NOT NULL
);

CREATE TRIGGER community_evidence_upgrades_effect_applied
BEFORE INSERT ON community_evidence_upgrades
WHEN NOT EXISTS (SELECT 1 FROM community_effect_applications a
                 WHERE a.application_id = NEW.effect_application_id AND a.state = 'applied'
                   AND a.report_type = 'exists' AND a.subject_spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_upgrades: the effect is not an applied exists confirmation of this spot');
END;

CREATE TRIGGER community_evidence_upgrades_spot_reported
BEFORE INSERT ON community_evidence_upgrades
WHEN NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = NEW.spot_id AND s.merged_into IS NULL
                   AND s.lifecycle = 'active' AND s.evidence_quality = 'communityReported')
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_upgrades: only a live communityReported spot is upgraded');
END;

-- Every confirming report consented to the report terms, like the evidence it corroborates.
CREATE TRIGGER community_evidence_upgrades_consented
BEFORE INSERT ON community_evidence_upgrades
WHEN EXISTS (SELECT 1 FROM community_effect_evidence e JOIN reports r ON r.report_id = e.report_id
             WHERE e.application_id = NEW.effect_application_id AND r.accepted_terms_version IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_upgrades: a confirming report has no terms consent');
END;

-- The spot's evidence reports: the reports of the applied new-spot application whose release created the spot.
CREATE VIEW community_spot_evidence_reports AS
SELECT s.spot_id, e.report_id
FROM spots s
JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
JOIN source_records rec ON rec.record_id = p.record_id
JOIN community_reconciliation_applications a ON a.release_id = rec.release_id AND a.state = 'applied'
JOIN community_reconciliation_evidence e ON e.application_id = a.application_id;

-- Independence, checked while every key involved still exists: no involved report is redacted, and the distinct
-- submitters over (original evidence ∪ confirmations) exceed the original ones and equal the recorded count.
CREATE TRIGGER community_evidence_upgrades_independent
BEFORE INSERT ON community_evidence_upgrades
WHEN (SELECT count(*) FROM (
        SELECT r.submitter_hash FROM community_spot_evidence_reports x JOIN reports r ON r.report_id = x.report_id
        WHERE x.spot_id = NEW.spot_id
        UNION ALL
        SELECT r.submitter_hash FROM community_effect_evidence e JOIN reports r ON r.report_id = e.report_id
        WHERE e.application_id = NEW.effect_application_id) WHERE submitter_hash IS NULL) > 0
  OR NEW.confirmations_after IS NOT (SELECT count(DISTINCT h) FROM (
        SELECT r.submitter_hash AS h FROM community_spot_evidence_reports x JOIN reports r ON r.report_id = x.report_id
        WHERE x.spot_id = NEW.spot_id
        UNION
        SELECT r.submitter_hash AS h FROM community_effect_evidence e JOIN reports r ON r.report_id = e.report_id
        WHERE e.application_id = NEW.effect_application_id))
  OR NEW.confirmations_after <= (SELECT count(DISTINCT r.submitter_hash) FROM community_spot_evidence_reports x
        JOIN reports r ON r.report_id = x.report_id WHERE x.spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_upgrades: the confirmation is not independent evidence (same submitter, or a redacted report)');
END;

CREATE TRIGGER community_evidence_upgrades_immutable
BEFORE UPDATE ON community_evidence_upgrades
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_upgrades: an upgrade is immutable');
END;

CREATE TRIGGER community_evidence_upgrades_no_delete
BEFORE DELETE ON community_evidence_upgrades
BEGIN
  SELECT RAISE(ABORT, 'community_evidence_upgrades: an upgrade is never deleted');
END;

-- The spot's tier changes only as the upgrade row (written earlier in the same batch) says, and never downward.
CREATE TRIGGER spots_evidence_changes_only_by_upgrade
BEFORE UPDATE OF evidence_quality, evidence_quality_version, community_confirmations, last_reviewed_on ON spots
WHEN (NEW.evidence_quality IS NOT OLD.evidence_quality OR NEW.evidence_quality_version IS NOT OLD.evidence_quality_version
      OR NEW.community_confirmations IS NOT OLD.community_confirmations OR NEW.last_reviewed_on IS NOT OLD.last_reviewed_on)
  AND NOT EXISTS (SELECT 1 FROM community_evidence_upgrades u
                  WHERE u.spot_id = NEW.spot_id AND OLD.evidence_quality = 'communityReported'
                    AND NEW.evidence_quality = 'communityVerified' AND NEW.evidence_quality_version = 'evidence-quality.v3'
                    AND NEW.community_confirmations = u.confirmations_after
                    AND NEW.last_reviewed_on = substr(u.applied_at, 1, 10))
BEGIN
  SELECT RAISE(ABORT, 'spots: evidence quality changes only through a recorded community evidence upgrade');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Empty target: both bootstrap guards name every table, now including 0023's (test/promotion-empty-target.test.ts).
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
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;

-- ---------------------------------------------------------------------------------------------------------
-- SQLite fires the most recently created trigger first. The completion seals on spots INSERT are recreated
-- unchanged after 0023's content checks, so a sealed database keeps answering "promoted state is immutable"
-- before any value check runs (test/promotion-completion-seal.test.ts).
DROP TRIGGER promotion_complete_seals_spots_insert;
CREATE TRIGGER promotion_complete_seals_spots_insert
BEFORE INSERT ON spots
WHEN EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;

DROP TRIGGER promotion_multi_complete_seals_spots_insert;
CREATE TRIGGER promotion_multi_complete_seals_spots_insert
BEFORE INSERT ON spots
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
BEGIN
  SELECT RAISE(ABORT, 'promotion bootstrap is complete; promoted state is immutable');
END;
