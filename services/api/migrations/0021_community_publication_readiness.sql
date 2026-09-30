-- Community publication readiness (Issue #124 technical half, Issue #127; ADR-0007 amendment 2026-09-30).
--
-- 1. Report terms consent. A report records the version of the report terms its submitter explicitly accepted
--    (`reports.accepted_terms_version`, NULL for every report stored before this migration and for a report sent
--    without consent). It is part of the immutable proposal, survives redaction (it is not personal), and is never
--    applied retroactively: a NULL can never become a version.
-- 2. report_terms_versions: the registry mirror of the reviewed terms documents (src/reports/terms.ts). A version
--    grants publication rights only when its row says `granted`, which only a reviewed repository change does. The
--    current document is a DRAFT (`pending`): nothing user-derived publishes on it.
-- 3. The publication gate for community spots: a userReport spot enters a tile only when its sanitized record names
--    ONE terms version (every evidence report consented to it) and that version is `granted`. This is on top of the
--    ordinary source gate (the community source is still `blocked`, Issue #124).
-- 4. Existing-spot report effects (Issue #127): accepted, queued reports about a published spot back an immutable
--    reviewed EFFECT application. Applying it records a review candidate and moves its reports to `applied`; it
--    changes nothing canonical. The one public-facing effect, a publication hold for `prohibited` reports, is a
--    separate explicit step that the database refuses unless the community rights hold (source approved, terms
--    granted, two independent submitters, fresh unredacted evidence).
--
-- Nothing personal is added: applications store report IDs, a spot ID, a bounded effect and a reviewer handle.
-- Each guard is its own small trigger (0018/0019: one large trigger exceeded D1's expression depth limit).

-- ---------------------------------------------------------------------------------------------------------
-- 1. Consent on the report itself.
ALTER TABLE reports ADD COLUMN accepted_terms_version TEXT
  CHECK (accepted_terms_version IS NULL OR (length(accepted_terms_version) BETWEEN 1 AND 64
    AND accepted_terms_version NOT GLOB '*[^a-z0-9.-]*'));

-- As in 0003, plus accepted_terms_version: consent is part of the immutable claim and never changes, not even by
-- redaction (it names a document, not a person).
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
BEGIN
  SELECT RAISE(ABORT, 'reports are immutable proposals; the only permitted update is redaction to NULL');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 2. The terms registry mirror. Rows are written only from the reviewed list in code (src/reports/terms.ts).
CREATE TABLE report_terms_versions (
  terms_version      TEXT PRIMARY KEY CHECK (length(terms_version) BETWEEN 1 AND 64 AND terms_version NOT GLOB '*[^a-z0-9.-]*'),
  -- The repository path of the document the submitter was shown, and the SHA-256 of its exact bytes.
  document_path      TEXT NOT NULL CHECK (document_path <> ''),
  document_sha256    TEXT NOT NULL CHECK (length(document_sha256) = 64 AND document_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- pending: shown and consented to, but not approved as a basis for republication (a draft).
  -- granted: legal/maintainer-approved basis for republishing reports consented under this version.
  -- revoked: no longer a basis; everything published on it leaves the tiles at the next publish.
  publication_rights TEXT NOT NULL CHECK (publication_rights IN ('pending', 'granted', 'revoked')),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TRIGGER report_terms_versions_document_immutable
BEFORE UPDATE ON report_terms_versions
WHEN NEW.terms_version IS NOT OLD.terms_version OR NEW.document_path IS NOT OLD.document_path
  OR NEW.document_sha256 IS NOT OLD.document_sha256 OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'report_terms_versions: a terms version names one document forever; publish a new version instead');
END;

CREATE TRIGGER report_terms_versions_no_delete
BEFORE DELETE ON report_terms_versions
BEGIN
  SELECT RAISE(ABORT, 'report_terms_versions: a consented terms version is never deleted');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Community publication rights. A community record's 7th value (index 6) is the terms version every evidence
-- report consented to, or '' (src/pipeline/community-adapter.ts, artifact v2). A v1 artifact has no 7th value.
CREATE VIEW community_spot_rights AS
SELECT s.spot_id,
       json_extract(r.raw_values_json, '$[6]') AS terms_version,
       CASE WHEN EXISTS (SELECT 1 FROM report_terms_versions t
                         WHERE t.terms_version = json_extract(r.raw_values_json, '$[6]') AND t.publication_rights = 'granted')
            THEN 1 ELSE 0 END AS rights_granted
FROM spots s
JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
JOIN source_records r ON r.record_id = p.record_id
JOIN source_releases rel ON rel.release_id = r.release_id
JOIN sources src ON src.source_id = rel.source_id AND src.kind = 'userReport';

CREATE TRIGGER tile_snapshot_spots_community_rights
BEFORE INSERT ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM community_spot_rights c WHERE c.spot_id = NEW.spot_id AND c.rights_granted = 0)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: a community spot publishes only on evidence consented under a granted terms version (Issue #124)');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Existing-spot report effects (Issue #127).
--
-- The effect follows from the report type and nothing else (src/pipeline/community-effects.ts):
--   moved              -> relocationReview          prohibited         -> publicationHoldReview
--   hoursChanged       -> hoursReview               accessChanged      -> accessReview
--   tobaccoTypeChanged -> tobaccoTypeReview         exists             -> existenceVerification
--   other              -> no application at all (review only, in the moderation queue)
CREATE TABLE community_effect_applications (
  application_id  TEXT PRIMARY KEY CHECK (length(application_id) = 29 AND application_id GLOB 'ce_[0-9A-HJKMNP-TV-Z]*'),
  -- The spot every evidence report names. Not a foreign key, like reports.subject_spot_id; checked on apply.
  subject_spot_id TEXT NOT NULL CHECK (length(subject_spot_id) = 29 AND subject_spot_id GLOB 'sp_[0-9A-HJKMNP-TV-Z]*'),
  report_type     TEXT NOT NULL CHECK (report_type IN ('moved', 'prohibited', 'hoursChanged', 'accessChanged', 'tobaccoTypeChanged', 'exists')),
  effect          TEXT NOT NULL CHECK (
    (report_type = 'moved' AND effect = 'relocationReview')
    OR (report_type = 'prohibited' AND effect = 'publicationHoldReview')
    OR (report_type = 'hoursChanged' AND effect = 'hoursReview')
    OR (report_type = 'accessChanged' AND effect = 'accessReview')
    OR (report_type = 'tobaccoTypeChanged' AND effect = 'tobaccoTypeReview')
    OR (report_type = 'exists' AND effect = 'existenceVerification')),
  effect_version  TEXT NOT NULL CHECK (effect_version = 'community-effects.v1'),
  decided_by      TEXT NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 64),
  decided_at      TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('proposed', 'applied', 'withdrawn')),
  applied_at      TEXT,
  withdrawn_at    TEXT,
  CHECK ((state = 'applied') = (applied_at IS NOT NULL)),
  CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);

CREATE INDEX community_effect_applications_spot ON community_effect_applications (subject_spot_id);

-- A report backs at most one effect application, ever, and never a new-spot application (different report types).
CREATE TABLE community_effect_evidence (
  report_id      TEXT PRIMARY KEY CHECK (length(report_id) = 29 AND report_id GLOB 'rp_[0-9A-HJKMNP-TV-Z]*'),
  application_id TEXT NOT NULL REFERENCES community_effect_applications (application_id)
);

CREATE INDEX community_effect_evidence_application ON community_effect_evidence (application_id);

CREATE TRIGGER community_effect_applications_born_proposed
BEFORE INSERT ON community_effect_applications
WHEN NEW.state <> 'proposed'
BEGIN
  SELECT RAISE(ABORT, 'community_effect_applications: an application is born proposed');
END;

CREATE TRIGGER community_effect_applications_decision_immutable
BEFORE UPDATE ON community_effect_applications
WHEN NEW.application_id IS NOT OLD.application_id OR NEW.subject_spot_id IS NOT OLD.subject_spot_id
  OR NEW.report_type IS NOT OLD.report_type OR NEW.effect IS NOT OLD.effect OR NEW.effect_version IS NOT OLD.effect_version
  OR NEW.decided_by IS NOT OLD.decided_by OR NEW.decided_at IS NOT OLD.decided_at
BEGIN
  SELECT RAISE(ABORT, 'community_effect_applications: a reviewed decision is immutable');
END;

CREATE TRIGGER community_effect_applications_one_way
BEFORE UPDATE ON community_effect_applications
WHEN NOT (OLD.state = 'proposed' AND NEW.state IN ('applied', 'withdrawn'))
BEGIN
  SELECT RAISE(ABORT, 'community_effect_applications: only proposed -> applied or proposed -> withdrawn');
END;

CREATE TRIGGER community_effect_applications_no_delete
BEFORE DELETE ON community_effect_applications
BEGIN
  SELECT RAISE(ABORT, 'community_effect_applications: applications are never deleted');
END;

CREATE TRIGGER community_effect_evidence_application_proposed
BEFORE INSERT ON community_effect_evidence
WHEN NOT EXISTS (SELECT 1 FROM community_effect_applications a
                 WHERE a.application_id = NEW.application_id AND a.state = 'proposed')
BEGIN
  SELECT RAISE(ABORT, 'community_effect_evidence: the application is not proposed');
END;

CREATE TRIGGER community_effect_evidence_report_eligible
BEFORE INSERT ON community_effect_evidence
WHEN NOT EXISTS (SELECT 1 FROM reports r
                 JOIN report_moderation m ON m.report_id = r.report_id
                 JOIN community_effect_applications a ON a.application_id = NEW.application_id
                 WHERE r.report_id = NEW.report_id AND r.redacted_at IS NULL
                   AND r.report_type = a.report_type AND r.subject_spot_id = a.subject_spot_id
                   AND m.state = 'accepted' AND m.reconciliation_state = 'queued')
BEGIN
  SELECT RAISE(ABORT, 'community_effect_evidence: the report is not an accepted, queued, unredacted report of this type about this spot');
END;

CREATE TRIGGER community_effect_evidence_not_new_spot
BEFORE INSERT ON community_effect_evidence
WHEN EXISTS (SELECT 1 FROM community_reconciliation_evidence e WHERE e.report_id = NEW.report_id)
BEGIN
  SELECT RAISE(ABORT, 'community_effect_evidence: the report already backs a new-spot application');
END;

CREATE TRIGGER community_effect_evidence_immutable
BEFORE UPDATE ON community_effect_evidence
BEGIN
  SELECT RAISE(ABORT, 'community_effect_evidence: evidence links are immutable');
END;

CREATE TRIGGER community_effect_evidence_no_delete
BEFORE DELETE ON community_effect_evidence
BEGIN
  SELECT RAISE(ABORT, 'community_effect_evidence: evidence links are never deleted');
END;

-- Apply premise, re-checked inside the apply batch (the application UPDATE is its first statement): at least one
-- report, every one still accepted, queued, unredacted and inside its minimization window.
CREATE TRIGGER community_effect_apply_reports_still_premised
BEFORE UPDATE OF state ON community_effect_applications
WHEN NEW.state = 'applied' AND (
  NOT EXISTS (SELECT 1 FROM community_effect_evidence e WHERE e.application_id = NEW.application_id)
  OR EXISTS (
    SELECT 1 FROM community_effect_evidence e
    LEFT JOIN reports r ON r.report_id = e.report_id
    LEFT JOIN report_moderation m ON m.report_id = e.report_id
    WHERE e.application_id = NEW.application_id
      AND (r.report_id IS NULL OR r.redacted_at IS NOT NULL OR r.minimize_after <= NEW.applied_at
        OR m.state IS NOT 'accepted' OR m.reconciliation_state IS NOT 'queued')))
BEGIN
  SELECT RAISE(ABORT, 'community effect apply: a linked report is no longer accepted, queued and unredacted');
END;

-- Reconciliation state machine (0003, 0020), plus: queued -> applied for a report linked to an applied effect
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
BEGIN
  SELECT RAISE(ABORT, 'report_moderation: illegal reconciliation transition (allowed: notQueued->queued, notQueued->discarded, queued->discarded, queued->applied only through an applied community application)');
END;

-- The publication hold of a `prohibited` effect. Append-only; `lifted_at` is set once by a reviewed lift. It is a
-- publication decision on its own axis, never a claim about the place: no canonical column of the spot changes.
CREATE TABLE community_publication_holds (
  application_id   TEXT PRIMARY KEY REFERENCES community_effect_applications (application_id),
  spot_id          TEXT NOT NULL REFERENCES spots (spot_id),
  executor_version TEXT NOT NULL CHECK (executor_version = 'community-hold.v1'),
  -- The terms version every evidence report consented to, recorded as the rights basis of the hold.
  terms_version    TEXT NOT NULL,
  held_at          TEXT NOT NULL,
  lifted_at        TEXT,
  lifted_by        TEXT CHECK (lifted_by IS NULL OR length(lifted_by) BETWEEN 1 AND 64),
  CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
);

CREATE UNIQUE INDEX community_publication_holds_one_active ON community_publication_holds (spot_id) WHERE lifted_at IS NULL;

-- Hold premises. Each is its own trigger (D1 expression depth).
-- a. The application is an applied publicationHoldReview of this spot, and the spot is unpublished already
--    (ADR-0006 decision 11: unpublish first; the hold step deletes the tile membership earlier in its batch).
CREATE TRIGGER community_hold_application_applied
BEFORE INSERT ON community_publication_holds
WHEN NOT EXISTS (SELECT 1 FROM community_effect_applications a
                 WHERE a.application_id = NEW.application_id AND a.state = 'applied'
                   AND a.effect = 'publicationHoldReview' AND a.subject_spot_id = NEW.spot_id)
  OR EXISTS (SELECT 1 FROM tile_snapshot_spots t WHERE t.spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'community hold: not an applied publicationHoldReview of this unpublished spot');
END;

-- b. Two independent submitters, every report still unredacted and inside its minimization window.
CREATE TRIGGER community_hold_evidence_fresh_and_independent
BEFORE INSERT ON community_publication_holds
WHEN (SELECT count(*) < 2 OR count(DISTINCT r.submitter_hash) <> count(*) OR count(r.submitter_hash) <> count(*)
        OR sum(CASE WHEN r.redacted_at IS NULL AND r.minimize_after > NEW.held_at THEN 0 ELSE 1 END) > 0
      FROM community_effect_evidence e LEFT JOIN reports r ON r.report_id = e.report_id
      WHERE e.application_id = NEW.application_id)
BEGIN
  SELECT RAISE(ABORT, 'community hold: fewer than two fresh, unredacted reports from distinct submitters');
END;

-- c. Rights: every evidence report consented to NEW.terms_version, that version is granted, and the community
--    source is approved. A report stored without consent (every report before 0021) is never a basis.
CREATE TRIGGER community_hold_rights
BEFORE INSERT ON community_publication_holds
WHEN EXISTS (SELECT 1 FROM community_effect_evidence e LEFT JOIN reports r ON r.report_id = e.report_id
             WHERE e.application_id = NEW.application_id AND r.accepted_terms_version IS NOT NEW.terms_version)
  OR NOT EXISTS (SELECT 1 FROM report_terms_versions t WHERE t.terms_version = NEW.terms_version AND t.publication_rights = 'granted')
  OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.kind = 'userReport' AND s.publication_status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'community hold: community publication rights do not hold (Issue #124: source approval, granted terms, consent on every report)');
END;

CREATE TRIGGER community_publication_holds_lift_only
BEFORE UPDATE ON community_publication_holds
WHEN NEW.application_id IS NOT OLD.application_id OR NEW.spot_id IS NOT OLD.spot_id
  OR NEW.executor_version IS NOT OLD.executor_version OR NEW.terms_version IS NOT OLD.terms_version
  OR NEW.held_at IS NOT OLD.held_at OR OLD.lifted_at IS NOT NULL OR NEW.lifted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'community_publication_holds: the only update is one reviewed lift');
END;

CREATE TRIGGER community_publication_holds_no_delete
BEFORE DELETE ON community_publication_holds
BEGIN
  SELECT RAISE(ABORT, 'community_publication_holds: holds are never deleted; lift them');
END;

CREATE TRIGGER tile_snapshot_spots_community_hold
BEFORE INSERT ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM community_publication_holds h WHERE h.spot_id = NEW.spot_id AND h.lifted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: the spot is held by a reviewed community report effect');
END;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Promotion v3 for an additive source (Issue #124 item 4). A userReport source has several applied releases and
-- none is current. Its v3 declaration keeps one row in promotion_multi_bootstrap_sources (release_id = its lowest
-- release, the anchor), and EVERY one of its releases, the anchor included, is declared below. The per-source
-- checks of 0018 are recreated over promotion_multi_declared_releases, which for every other source is exactly its
-- one declared release, so a bundle without an additive source is checked exactly as before.
CREATE TABLE promotion_multi_bootstrap_additive_releases (
  release_id             INTEGER PRIMARY KEY CHECK (release_id > 0),
  source_id              TEXT NOT NULL REFERENCES promotion_multi_bootstrap_sources (source_id),
  release_content_sha256 TEXT NOT NULL CHECK (length(release_content_sha256) = 64 AND release_content_sha256 NOT GLOB '*[^0-9a-f]*')
);

CREATE TRIGGER promotion_multi_bootstrap_additive_releases_valid
BEFORE INSERT ON promotion_multi_bootstrap_additive_releases
WHEN NOT EXISTS (SELECT 1 FROM promotion_multi_bootstraps b
                 WHERE (SELECT count(*) FROM promotion_multi_bootstrap_sources) = b.source_count)
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  OR EXISTS (SELECT 1 FROM sources) OR EXISTS (SELECT 1 FROM source_releases)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_additive_releases: declarations precede the data of an open v3 bootstrap');
END;

CREATE TRIGGER promotion_multi_bootstrap_additive_releases_immutable
BEFORE UPDATE ON promotion_multi_bootstrap_additive_releases
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_additive_releases are immutable');
END;

CREATE TRIGGER promotion_multi_bootstrap_additive_releases_no_delete
BEFORE DELETE ON promotion_multi_bootstrap_additive_releases
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_additive_releases are immutable');
END;

-- Every declared release: a non-additive source's one current release, or each release of an additive source.
CREATE VIEW promotion_multi_declared_releases AS
SELECT d.source_id, d.release_id, d.release_content_sha256, 1 AS is_current
FROM promotion_multi_bootstrap_sources d
WHERE NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases a WHERE a.source_id = d.source_id)
UNION ALL
SELECT a.source_id, a.release_id, a.release_content_sha256, 0 AS is_current
FROM promotion_multi_bootstrap_additive_releases a;

DROP TRIGGER promotion_multi_open_source_releases_insert;

CREATE TRIGGER promotion_multi_open_source_releases_insert
BEFORE INSERT ON source_releases
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND NOT EXISTS (SELECT 1 FROM promotion_multi_declared_releases d
    WHERE d.release_id = NEW.release_id AND d.source_id IS NEW.source_id AND d.release_content_sha256 IS NEW.content_sha256
      AND NEW.status = 'applied' AND NEW.is_current = d.is_current)
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: only a declared release with its declared fingerprint may be written');
END;

DROP TRIGGER promotion_multi_bootstrap_completions_valid_cardinality;

CREATE TRIGGER promotion_multi_bootstrap_completions_valid_cardinality
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND (SELECT count(*) FROM promotion_multi_bootstrap_sources) = b.source_count
    AND (SELECT count(*) FROM sources) = b.source_count
    AND (SELECT count(*) FROM source_releases) = (SELECT count(*) FROM promotion_multi_declared_releases))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (declaration and bootstrap cardinality)');
END;

DROP TRIGGER promotion_multi_bootstrap_completions_valid_source_identity;

CREATE TRIGGER promotion_multi_bootstrap_completions_valid_source_identity
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE NOT
      EXISTS (SELECT 1 FROM sources s WHERE s.source_id = d.source_id AND s.publication_status = 'approved'
        AND s.display_name IS d.display_name AND s.license_name IS d.license_name AND s.license_url IS d.license_url AND s.attribution_text IS d.attribution_text))
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_declared_releases v WHERE NOT EXISTS (
      SELECT 1 FROM source_releases r WHERE r.release_id = v.release_id AND r.source_id = v.source_id
        AND r.content_sha256 = v.release_content_sha256 AND r.status = 'applied' AND r.is_current = v.is_current)))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (per-source registry identity and release fingerprint)');
END;

-- An additive release belongs only to a userReport source.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_additive_kind
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases a
             WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.source_id = a.source_id AND s.kind = 'userReport'))
  OR EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d
             WHERE EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases a WHERE a.source_id = d.source_id)
               AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases a WHERE a.release_id = d.release_id AND a.source_id = d.source_id))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: an additive release declaration is not of a userReport source, or misses its anchor');
END;

DROP TRIGGER promotion_multi_bootstrap_completions_valid_source_rows_a;

CREATE TRIGGER promotion_multi_bootstrap_completions_valid_source_rows_a
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE NOT (
      (SELECT count(*) FROM source_releases r WHERE r.source_id = d.source_id) IS json_extract(d.expected_rows_json, '$.source_releases')
      AND (SELECT count(*) FROM source_records x WHERE x.release_id IN (SELECT v.release_id FROM promotion_multi_declared_releases v WHERE v.source_id = d.source_id)) IS json_extract(d.expected_rows_json, '$.source_records')
      AND (SELECT count(*) FROM source_record_match_keys k JOIN source_records x ON x.record_id = k.record_id WHERE x.release_id IN (SELECT v.release_id FROM promotion_multi_declared_releases v WHERE v.source_id = d.source_id)) IS json_extract(d.expected_rows_json, '$.source_record_match_keys')
      AND (SELECT count(*) FROM source_entities e WHERE e.source_id = d.source_id) IS json_extract(d.expected_rows_json, '$.source_entities'))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (per-source row counts: releases, records, match keys, entities)');
END;

DROP TRIGGER promotion_multi_bootstrap_completions_valid_source_rows_b;

CREATE TRIGGER promotion_multi_bootstrap_completions_valid_source_rows_b
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE NOT (
      (SELECT count(*) FROM promotion_review_match_attestations a WHERE a.release_id IN (SELECT v.release_id FROM promotion_multi_declared_releases v WHERE v.source_id = d.source_id)) IS json_extract(d.expected_rows_json, '$.promotion_review_match_attestations')
      AND (SELECT count(*) FROM source_record_entities e WHERE e.release_id IN (SELECT v.release_id FROM promotion_multi_declared_releases v WHERE v.source_id = d.source_id)) IS json_extract(d.expected_rows_json, '$.source_record_entities')
      AND (SELECT count(*) FROM spot_source_entities l JOIN source_entities e ON e.source_entity_id = l.source_entity_id WHERE e.source_id = d.source_id) IS json_extract(d.expected_rows_json, '$.spot_source_entities')
      AND (SELECT count(*) FROM spot_field_provenance p JOIN source_records x ON x.record_id = p.record_id WHERE x.release_id IN (SELECT v.release_id FROM promotion_multi_declared_releases v WHERE v.source_id = d.source_id)) IS json_extract(d.expected_rows_json, '$.spot_field_provenance'))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: the database does not hold exactly the declared, complete sources (per-source row counts: attestations, record entities, spot links, provenance)');
END;

-- 0018's attestation guard counted one release per declared source; with an additive source the declared release
-- set is larger. The v2 branch is 0018's, verbatim; the v3 branch counts promotion_multi_declared_releases.
DROP TRIGGER promotion_review_match_attestations_valid;

CREATE TRIGGER promotion_review_match_attestations_valid
BEFORE INSERT ON promotion_review_match_attestations
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_bootstraps b
  WHERE b.release_id = NEW.release_id
    AND NOT EXISTS (SELECT 1 FROM promotion_bootstrap_completions)
    AND (SELECT count(*) FROM sources) = 1
    AND EXISTS (SELECT 1 FROM sources s WHERE s.source_id = b.source_id)
    AND (SELECT count(*) FROM source_releases) = 1
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = b.release_id AND r.source_id = b.source_id
      AND r.content_sha256 = b.release_content_sha256 AND r.status = 'applied' AND r.is_current = 1)
    AND NOT EXISTS (SELECT 1 FROM review_items)
    AND NOT EXISTS (SELECT 1 FROM review_decisions)
    AND NOT EXISTS (SELECT 1 FROM review_match_applications)
    AND NOT EXISTS (SELECT 1 FROM source_observations)
    AND NOT EXISTS (SELECT 1 FROM source_record_entities)
    AND NOT EXISTS (SELECT 1 FROM spots)
    AND NOT EXISTS (SELECT 1 FROM tile_snapshots)
    AND json_array_length(NEW.candidate_entity_ids_json) > 0
    AND NOT EXISTS (SELECT 1 FROM json_each(NEW.candidate_entity_ids_json) j WHERE j.type <> 'integer')
    AND (SELECT count(DISTINCT value) FROM json_each(NEW.candidate_entity_ids_json)) = json_array_length(NEW.candidate_entity_ids_json)
    AND (NEW.source_entity_id IS NULL OR (
      NEW.source_entity_id IN (SELECT value FROM json_each(NEW.candidate_entity_ids_json))
      AND EXISTS (SELECT 1 FROM source_entities se WHERE se.source_entity_id = NEW.source_entity_id AND se.source_id = b.source_id))))
AND NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  JOIN promotion_multi_bootstrap_sources d ON d.promotion_bootstrap_id = b.promotion_bootstrap_id AND d.release_id = NEW.release_id
  WHERE NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
    AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_additive_releases a WHERE a.source_id = d.source_id)
    AND (SELECT count(*) FROM promotion_multi_bootstrap_sources) = b.source_count
    AND (SELECT count(*) FROM sources) = b.source_count
    AND (SELECT count(*) FROM source_releases) = (SELECT count(*) FROM promotion_multi_declared_releases)
    AND EXISTS (SELECT 1 FROM source_releases r WHERE r.release_id = d.release_id AND r.source_id = d.source_id
      AND r.content_sha256 = d.release_content_sha256 AND r.status = 'applied' AND r.is_current = 1)
    AND NOT EXISTS (SELECT 1 FROM review_items)
    AND NOT EXISTS (SELECT 1 FROM review_decisions)
    AND NOT EXISTS (SELECT 1 FROM review_match_applications)
    AND NOT EXISTS (SELECT 1 FROM source_observations)
    AND NOT EXISTS (SELECT 1 FROM source_record_entities)
    AND NOT EXISTS (SELECT 1 FROM spots)
    AND NOT EXISTS (SELECT 1 FROM tile_snapshots)
    AND NEW.previous_release_id NOT IN (SELECT release_id FROM promotion_multi_declared_releases)
    AND json_array_length(NEW.candidate_entity_ids_json) > 0
    AND NOT EXISTS (SELECT 1 FROM json_each(NEW.candidate_entity_ids_json) j WHERE j.type <> 'integer')
    AND (SELECT count(DISTINCT value) FROM json_each(NEW.candidate_entity_ids_json)) = json_array_length(NEW.candidate_entity_ids_json)
    AND NOT EXISTS (SELECT 1 FROM json_each(NEW.candidate_entity_ids_json) j
      WHERE NOT EXISTS (SELECT 1 FROM source_entities se WHERE se.source_entity_id = j.value AND se.source_id = d.source_id))
    AND (NEW.source_entity_id IS NULL OR (
      NEW.source_entity_id IN (SELECT value FROM json_each(NEW.candidate_entity_ids_json))
      AND EXISTS (SELECT 1 FROM source_entities se WHERE se.source_entity_id = NEW.source_entity_id AND se.source_id = d.source_id))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_review_match_attestations: not a reviewed decision of an open bootstrap''s release (record, entity, candidates or order)');
END;

-- The terms rows a promoted community spot depends on travel with it (src/pipeline/promotion.ts), and only granted
-- ones: while a v3 bootstrap is open a terms row is written only as `granted`, and only after its sources.
CREATE TRIGGER promotion_multi_open_report_terms_versions
BEFORE INSERT ON report_terms_versions
WHEN EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND (NEW.publication_rights <> 'granted' OR NOT EXISTS (SELECT 1 FROM sources WHERE kind = 'userReport'))
BEGIN
  SELECT RAISE(ABORT, 'promotion v3 bootstrap is open: only a granted terms version of a carried community source may be written');
END;

-- Completion: the runtime community state never travels.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_community_nothing_else
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM community_reconciliation_applications) OR EXISTS (SELECT 1 FROM community_reconciliation_evidence)
  OR EXISTS (SELECT 1 FROM community_effect_applications) OR EXISTS (SELECT 1 FROM community_effect_evidence)
  OR EXISTS (SELECT 1 FROM community_publication_holds) OR EXISTS (SELECT 1 FROM reports) OR EXISTS (SELECT 1 FROM report_moderation)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: a bundle carries no report or community review state');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Empty target: both bootstrap guards name every table, now including 0021's (test/promotion-empty-target.test.ts).
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
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;
