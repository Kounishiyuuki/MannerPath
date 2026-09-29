-- Cross-source review and merge (ADR-0008 decision 4, "Amendment — cross-source review and merge";
-- docs/NATIONWIDE_DATA_STRATEGY.md §2/§7/§10 step 7; Issue #107). Persists the planning foundation of the unmerged
-- commit bf225b3: candidates, reviewed decisions, the audited merge application and its promotion attestation.
--
-- Why new tables rather than review_items/review_decisions: a review item names ONE source, ONE release (with its
-- fingerprint and the previous release of the same source) and at most one record/entity/spot, and every 0009-0015
-- trigger reads it that way. A cross-source candidate is a PAIR of canonical spots of two sources and cites no
-- release pair of one source, so storing it there would either break those triggers' meaning or need them all
-- rewritten. The decision vocabulary also differs. The semantics are kept identical: candidates are immutable,
-- decisions append-only, the latest decision is the largest id, decided_at is evidence, never precedence.
--
-- cross_source_candidates        a recall candidate (cross-source-candidate.v1): two live spots of two different
--                                approved sources, each bound to its complete canonical state (state_json, below).
--                                Proximity or name is recall only, never identity.
-- cross_source_decisions         a reviewer's answer: sameRealWorldSpot (with the survivor chosen explicitly and
--                                identity evidence), distinctSpots or insufficientEvidence. Evidence, not an edit.
-- cross_source_merge_applications the merge. Inserting the row IS the merge (the 0015 pattern): its BEFORE triggers
--                                re-check the premise inside the statement and its AFTER trigger unpublishes the
--                                affected spots, repoints inbound redirects and redirects the loser, so a merge row
--                                never exists without its merge and nothing is half applied.
-- promotion_cross_source_merge_attestations  what a v3 bundle carries instead of that runtime chain.
--
-- A merge never deletes a spot, never issues an id, never relinks an entity and never rewrites provenance: the loser
-- keeps its links, provenance and attenuations, so every source's evidence stays as its source stated it. The
-- survivor keeps publishing only its own values, and only while it agrees with every loser on every semantic field
-- (cross_source_publication_blocks); a disagreement is held, never resolved by a source priority.
--
-- D1 limits: every condition is split over small triggers (0018: one trigger over D1's expression depth limit of
-- 100 made every bundle fail), and state is compared as json_array text so no long `||` chains are built.

-- ---------------------------------------------------------------------------------------------------------
-- Views: the only definitions of "a spot's state", "a spot's semantic values", "the source behind a spot" and
-- "which survivors may not publish". Executor, triggers, publisher and exporter all read these.

-- The complete canonical state a candidate is bound to: the row, its provenance, attenuations, entity links and
-- inbound redirects. Any change to any of them changes state_json, which makes a candidate and its decisions stale.
CREATE VIEW cross_source_spot_state AS
SELECT s.spot_id,
  json_array(
    json_array(s.spot_id, s.merged_into, s.name, s.latitude, s.longitude, s.tile_id, s.spot_type, s.host_type,
      s.access_type, s.environment, s.supports_paper, s.supports_heated, s.opening_hours_raw, s.opening_hours_json,
      s.opening_hours_status, s.time_zone, s.fee_type, s.floor, s.entrance_note, s.lifecycle, s.publication_hold,
      s.evidence_quality, s.evidence_quality_version, s.last_verified_at, s.resolver_version, s.updated_at),
    (SELECT json_group_array(json_array(p.field, p.record_id, p.source_columns_json, p.rule, p.resolver_version, p.resolved_at))
     FROM (SELECT * FROM spot_field_provenance x WHERE x.spot_id = s.spot_id ORDER BY x.field) p),
    (SELECT json_group_array(json_array(a.field, a.effect, a.attestation_version, a.release_id, a.applied_at))
     FROM (SELECT * FROM spot_field_attenuations x WHERE x.spot_id = s.spot_id ORDER BY x.field, x.effect) a),
    (SELECT json_group_array(json_array(l.source_entity_id, l.method, l.linked_at, l.resolver_version))
     FROM (SELECT * FROM spot_source_entities x WHERE x.spot_id = s.spot_id ORDER BY x.source_entity_id) l),
    (SELECT json_group_array(i.spot_id)
     FROM (SELECT x.spot_id FROM spots x WHERE x.merged_into = s.spot_id ORDER BY x.spot_id) i)
  ) AS state_json
FROM spots s;

-- The semantic values two sources can disagree on. Equal text means no conflict; the name is a display label
-- and not a claim about smoking, so it is kept in state_json but is not compared here.
CREATE VIEW cross_source_spot_values AS
SELECT spot_id,
  json_array(latitude, longitude, spot_type, host_type, access_type, environment, supports_paper, supports_heated,
    opening_hours_status, opening_hours_json, opening_hours_raw, time_zone, fee_type, floor, entrance_note, lifecycle) AS values_json
FROM spots;

-- A spot's single evidence source: the source of its existence record, when that release is applied and current,
-- the source approved, and the spot linked to exactly one entity of that source (and to no other entity).
CREATE VIEW cross_source_spot_sources AS
SELECT s.spot_id, rel.source_id, p.record_id, rel.release_id, l.source_entity_id
FROM spots s
JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
JOIN source_records r ON r.record_id = p.record_id
JOIN source_releases rel ON rel.release_id = r.release_id AND rel.status = 'applied' AND rel.is_current = 1
JOIN sources src ON src.source_id = rel.source_id AND src.publication_status = 'approved'
JOIN spot_source_entities l ON l.spot_id = s.spot_id
JOIN source_entities e ON e.source_entity_id = l.source_entity_id AND e.source_id = rel.source_id
WHERE (SELECT count(*) FROM spot_source_entities x WHERE x.spot_id = s.spot_id) = 1;

-- ---------------------------------------------------------------------------------------------------------
-- Candidates.
CREATE TABLE cross_source_candidates (
  cross_source_candidate_id INTEGER PRIMARY KEY,
  -- Only 'cross-source-candidate.v1' exists; a v2 replaces cross_source_candidates_version.
  algorithm_version  TEXT NOT NULL,
  spot_a_id          TEXT NOT NULL REFERENCES spots (spot_id),
  spot_b_id          TEXT NOT NULL REFERENCES spots (spot_id),
  source_a_id        TEXT NOT NULL REFERENCES sources (source_id),
  source_b_id        TEXT NOT NULL REFERENCES sources (source_id),
  -- Recall facts computed by the generator (not identity evidence): great-circle metres and the reasons it held.
  distance_m         REAL NOT NULL CHECK (distance_m >= 0),
  reasons_json       TEXT NOT NULL CHECK (json_valid(reasons_json) AND json_type(reasons_json) = 'array' AND json_array_length(reasons_json) > 0),
  -- cross_source_spot_state.state_json of each spot at creation: the snapshot every decision and the merge bind to.
  state_a_json       TEXT NOT NULL,
  state_b_json       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  CHECK (spot_a_id < spot_b_id),
  CHECK (source_a_id <> source_b_id),
  -- Same pair, same states, same algorithm: the same candidate (re-running generation is a no-op).
  UNIQUE (algorithm_version, spot_a_id, spot_b_id, state_a_json, state_b_json)
);

CREATE INDEX cross_source_candidates_spots ON cross_source_candidates (spot_a_id, spot_b_id);

CREATE TRIGGER cross_source_candidates_version
BEFORE INSERT ON cross_source_candidates
WHEN NEW.algorithm_version IS NOT 'cross-source-candidate.v1'
BEGIN
  SELECT RAISE(ABORT, 'cross_source_candidates: unknown algorithm_version');
END;

-- Each spot is live, unheld and backed by exactly one approved, current source: the one the row names.
CREATE TRIGGER cross_source_candidates_sources
BEFORE INSERT ON cross_source_candidates
WHEN NOT EXISTS (SELECT 1 FROM cross_source_spot_sources x WHERE x.spot_id = NEW.spot_a_id AND x.source_id = NEW.source_a_id)
  OR NOT EXISTS (SELECT 1 FROM cross_source_spot_sources x WHERE x.spot_id = NEW.spot_b_id AND x.source_id = NEW.source_b_id)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_candidates: each spot must be backed by exactly one approved, current source, the one named');
END;

CREATE TRIGGER cross_source_candidates_live
BEFORE INSERT ON cross_source_candidates
WHEN NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = NEW.spot_a_id AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL)
  OR NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = NEW.spot_b_id AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_candidates: both spots must be active, unmerged and unheld');
END;

CREATE TRIGGER cross_source_candidates_state
BEFORE INSERT ON cross_source_candidates
WHEN NEW.state_a_json IS NOT (SELECT state_json FROM cross_source_spot_state WHERE spot_id = NEW.spot_a_id)
  OR NEW.state_b_json IS NOT (SELECT state_json FROM cross_source_spot_state WHERE spot_id = NEW.spot_b_id)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_candidates: state snapshot does not match the spots');
END;

CREATE TRIGGER cross_source_candidates_immutable
BEFORE UPDATE ON cross_source_candidates
BEGIN
  SELECT RAISE(ABORT, 'cross_source_candidates are immutable');
END;

CREATE TRIGGER cross_source_candidates_no_delete
BEFORE DELETE ON cross_source_candidates
BEGIN
  SELECT RAISE(ABORT, 'cross_source_candidates are immutable');
END;

-- A candidate is current while both spots are still exactly in the state it was created from.
CREATE VIEW cross_source_current_candidates AS
SELECT c.* FROM cross_source_candidates c
WHERE c.state_a_json IS (SELECT state_json FROM cross_source_spot_state WHERE spot_id = c.spot_a_id)
  AND c.state_b_json IS (SELECT state_json FROM cross_source_spot_state WHERE spot_id = c.spot_b_id);

-- ---------------------------------------------------------------------------------------------------------
-- Decisions.
CREATE TABLE cross_source_decisions (
  cross_source_decision_id  INTEGER PRIMARY KEY,
  cross_source_candidate_id INTEGER NOT NULL REFERENCES cross_source_candidates (cross_source_candidate_id),
  decision           TEXT NOT NULL CHECK (decision IN ('sameRealWorldSpot', 'distinctSpots', 'insufficientEvidence')),
  -- Only 'cross-source-decision.v1' exists; a v2 replaces cross_source_decisions_valid.
  decision_version   TEXT NOT NULL,
  -- The explicitly chosen existing survivor: required for sameRealWorldSpot, NULL otherwise.
  survivor_spot_id   TEXT REFERENCES spots (spot_id),
  -- Specific smoking-location identity evidence (not proximity, not a host or business name). Required for
  -- sameRealWorldSpot.
  identity_evidence  TEXT,
  decided_by         TEXT NOT NULL CHECK (trim(decided_by) <> ''),
  decided_at         TEXT NOT NULL CHECK (trim(decided_at) <> ''),
  note               TEXT
);

CREATE INDEX cross_source_decisions_candidate ON cross_source_decisions (cross_source_candidate_id, cross_source_decision_id);

CREATE TRIGGER cross_source_decisions_valid
BEFORE INSERT ON cross_source_decisions
WHEN NEW.decision_version IS NOT 'cross-source-decision.v1'
  OR (NEW.decision = 'sameRealWorldSpot' AND (NEW.identity_evidence IS NULL OR trim(NEW.identity_evidence) = ''
    OR NOT EXISTS (SELECT 1 FROM cross_source_candidates c WHERE c.cross_source_candidate_id = NEW.cross_source_candidate_id
      AND NEW.survivor_spot_id IN (c.spot_a_id, c.spot_b_id))))
  OR (NEW.decision <> 'sameRealWorldSpot' AND NEW.survivor_spot_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_decisions: decision, version, survivor or identity evidence is not valid for this candidate');
END;

-- A reviewer answers the snapshot they saw: a stale candidate takes no decision (generate a new one).
CREATE TRIGGER cross_source_decisions_current
BEFORE INSERT ON cross_source_decisions
WHEN NOT EXISTS (SELECT 1 FROM cross_source_current_candidates c WHERE c.cross_source_candidate_id = NEW.cross_source_candidate_id)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_decisions: the candidate is stale (a spot changed since it was generated)');
END;

CREATE TRIGGER cross_source_decisions_immutable
BEFORE UPDATE ON cross_source_decisions
BEGIN
  SELECT RAISE(ABORT, 'cross_source_decisions are immutable; record a new decision instead');
END;

CREATE TRIGGER cross_source_decisions_no_delete
BEFORE DELETE ON cross_source_decisions
BEGIN
  SELECT RAISE(ABORT, 'cross_source_decisions are immutable; record a new decision instead');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Merge applications.
CREATE TABLE cross_source_merge_applications (
  cross_source_merge_application_id INTEGER PRIMARY KEY,
  cross_source_candidate_id INTEGER NOT NULL UNIQUE REFERENCES cross_source_candidates (cross_source_candidate_id),
  cross_source_decision_id  INTEGER NOT NULL UNIQUE REFERENCES cross_source_decisions (cross_source_decision_id),
  survivor_spot_id   TEXT NOT NULL REFERENCES spots (spot_id),
  -- A spot is merged away at most once.
  loser_spot_id      TEXT NOT NULL UNIQUE REFERENCES spots (spot_id),
  -- The spots that redirected to the loser and are repointed to the survivor (one hop kept), as a sorted array.
  redirected_spot_ids_json TEXT NOT NULL CHECK (json_valid(redirected_spot_ids_json) AND json_type(redirected_spot_ids_json) = 'array'),
  -- The differing semantic fields (audit). conflict_hold is what the schema enforces: 1 when the two spots'
  -- values differ, or when either is already the survivor of a held merge.
  conflicts_json     TEXT NOT NULL CHECK (json_valid(conflicts_json) AND json_type(conflicts_json) = 'array'),
  conflict_hold      INTEGER NOT NULL CHECK (conflict_hold IN (0, 1)),
  -- Only 'cross-source-merge.v1' exists; a v2 replaces cross_source_merge_applications_decision.
  executor_version   TEXT NOT NULL,
  applied_at         TEXT NOT NULL,
  CHECK (survivor_spot_id <> loser_spot_id),
  CHECK ((json_array_length(conflicts_json) > 0) <= conflict_hold)
);

-- The decision applied is the candidate's LATEST, a sameRealWorldSpot naming this survivor, and the loser is the
-- candidate's other spot.
CREATE TRIGGER cross_source_merge_applications_decision
BEFORE INSERT ON cross_source_merge_applications
WHEN NOT EXISTS (
  SELECT 1 FROM cross_source_candidates c
  JOIN cross_source_decisions d ON d.cross_source_candidate_id = c.cross_source_candidate_id
  WHERE c.cross_source_candidate_id = NEW.cross_source_candidate_id
    AND d.cross_source_decision_id = NEW.cross_source_decision_id
    AND d.cross_source_decision_id = (SELECT max(cross_source_decision_id) FROM cross_source_decisions WHERE cross_source_candidate_id = c.cross_source_candidate_id)
    AND d.decision = 'sameRealWorldSpot' AND d.decision_version = 'cross-source-decision.v1'
    AND d.survivor_spot_id = NEW.survivor_spot_id
    AND NEW.loser_spot_id = CASE WHEN c.spot_a_id = NEW.survivor_spot_id THEN c.spot_b_id ELSE c.spot_a_id END
    AND NEW.executor_version = 'cross-source-merge.v1')
BEGIN
  SELECT RAISE(ABORT, 'cross_source_merge_applications: not the latest sameRealWorldSpot decision of this candidate, survivor and loser');
END;

-- Both spots are still exactly in the candidate's state (the snapshot the reviewer decided on).
CREATE TRIGGER cross_source_merge_applications_current
BEFORE INSERT ON cross_source_merge_applications
WHEN NOT EXISTS (SELECT 1 FROM cross_source_current_candidates c WHERE c.cross_source_candidate_id = NEW.cross_source_candidate_id)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_merge_applications: the candidate is stale (a spot changed since it was reviewed)');
END;

-- Still live, unheld and backed by their approved, current sources (a source that was blocked or superseded since).
CREATE TRIGGER cross_source_merge_applications_live
BEFORE INSERT ON cross_source_merge_applications
WHEN NOT EXISTS (SELECT 1 FROM cross_source_candidates c WHERE c.cross_source_candidate_id = NEW.cross_source_candidate_id
    AND EXISTS (SELECT 1 FROM cross_source_spot_sources x WHERE x.spot_id = c.spot_a_id AND x.source_id = c.source_a_id)
    AND EXISTS (SELECT 1 FROM cross_source_spot_sources x WHERE x.spot_id = c.spot_b_id AND x.source_id = c.source_b_id))
  OR NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = NEW.survivor_spot_id AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL)
  OR NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = NEW.loser_spot_id AND s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_merge_applications: a spot is no longer live, unheld and backed by its approved, current source');
END;

-- The redirects to repoint are exactly the loser's current inbound redirects.
CREATE TRIGGER cross_source_merge_applications_redirects
BEFORE INSERT ON cross_source_merge_applications
WHEN NEW.redirected_spot_ids_json IS NOT (SELECT json_group_array(i.spot_id)
  FROM (SELECT x.spot_id FROM spots x WHERE x.merged_into = NEW.loser_spot_id ORDER BY x.spot_id) i)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_merge_applications: redirected spots are not exactly the loser''s inbound redirects');
END;

-- The hold is not the executor's opinion: it is 1 exactly when the values differ or either spot already survives
-- a held merge (a held chain stays held when it is merged again).
CREATE TRIGGER cross_source_merge_applications_hold
BEFORE INSERT ON cross_source_merge_applications
WHEN NEW.conflict_hold IS NOT (CASE
  WHEN (SELECT values_json FROM cross_source_spot_values WHERE spot_id = NEW.survivor_spot_id)
    IS NOT (SELECT values_json FROM cross_source_spot_values WHERE spot_id = NEW.loser_spot_id) THEN 1
  WHEN EXISTS (SELECT 1 FROM cross_source_merge_applications m
    WHERE m.survivor_spot_id IN (NEW.survivor_spot_id, NEW.loser_spot_id) AND m.conflict_hold = 1) THEN 1
  ELSE 0 END)
BEGIN
  SELECT RAISE(ABORT, 'cross_source_merge_applications: conflict_hold does not match the spots'' values');
END;

-- The merge itself, in the same statement: unpublish the loser (and a held survivor), repoint the loser's inbound
-- redirects to the survivor, then redirect the loser. The 0001 triggers keep redirects one hop and permanent.
CREATE TRIGGER cross_source_merge_applications_apply
AFTER INSERT ON cross_source_merge_applications
BEGIN
  DELETE FROM tile_snapshot_spots
  WHERE spot_id = NEW.loser_spot_id OR (spot_id = NEW.survivor_spot_id AND NEW.conflict_hold = 1);
  UPDATE spots SET merged_into = NEW.survivor_spot_id WHERE merged_into = NEW.loser_spot_id;
  UPDATE spots SET merged_into = NEW.survivor_spot_id, updated_at = NEW.applied_at WHERE spot_id = NEW.loser_spot_id;
END;

CREATE TRIGGER cross_source_merge_applications_immutable
BEFORE UPDATE ON cross_source_merge_applications
BEGIN
  SELECT RAISE(ABORT, 'cross_source_merge_applications are immutable');
END;

CREATE TRIGGER cross_source_merge_applications_no_delete
BEFORE DELETE ON cross_source_merge_applications
BEGIN
  SELECT RAISE(ABORT, 'cross_source_merge_applications are immutable');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Promotion: the attestation a v3 bundle carries for each applied merge (the runtime chain never travels, as for
-- promotion_review_match_attestations). origin_* ids name rows of the database that reviewed and applied it.
CREATE TABLE promotion_cross_source_merge_attestations (
  loser_spot_id              TEXT PRIMARY KEY,
  survivor_spot_id           TEXT NOT NULL,
  survivor_source_id         TEXT NOT NULL,
  loser_source_id            TEXT NOT NULL,
  origin_candidate_id        INTEGER NOT NULL,
  origin_decision_id         INTEGER NOT NULL,
  origin_application_id      INTEGER NOT NULL,
  algorithm_version          TEXT NOT NULL,
  distance_m                 REAL NOT NULL,
  reasons_json               TEXT NOT NULL CHECK (json_valid(reasons_json)),
  decision_version           TEXT NOT NULL,
  decided_by                 TEXT NOT NULL,
  decided_at                 TEXT NOT NULL,
  identity_evidence          TEXT NOT NULL CHECK (trim(identity_evidence) <> ''),
  decision_note              TEXT,
  redirected_spot_ids_json   TEXT NOT NULL CHECK (json_valid(redirected_spot_ids_json) AND json_type(redirected_spot_ids_json) = 'array'),
  conflicts_json             TEXT NOT NULL CHECK (json_valid(conflicts_json) AND json_type(conflicts_json) = 'array'),
  conflict_hold              INTEGER NOT NULL CHECK (conflict_hold IN (0, 1)),
  executor_version           TEXT NOT NULL,
  applied_at                 TEXT NOT NULL,
  CHECK (survivor_spot_id <> loser_spot_id),
  CHECK (survivor_source_id <> loser_source_id),
  CHECK ((json_array_length(conflicts_json) > 0) <= conflict_hold)
);

-- Written only by an open v3 bootstrap, after every declared source and release and before any spot: both sources
-- declared, the versions known.
CREATE TRIGGER promotion_cross_source_merge_attestations_valid
BEFORE INSERT ON promotion_cross_source_merge_attestations
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
    AND (SELECT count(*) FROM source_releases) = b.source_count
    AND NOT EXISTS (SELECT 1 FROM spots)
    AND NOT EXISTS (SELECT 1 FROM tile_snapshots)
    AND NOT EXISTS (SELECT 1 FROM cross_source_candidates)
    AND EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE d.source_id = NEW.survivor_source_id)
    AND EXISTS (SELECT 1 FROM promotion_multi_bootstrap_sources d WHERE d.source_id = NEW.loser_source_id)
    AND NEW.algorithm_version = 'cross-source-candidate.v1'
    AND NEW.decision_version = 'cross-source-decision.v1'
    AND NEW.executor_version = 'cross-source-merge.v1')
BEGIN
  SELECT RAISE(ABORT, 'promotion_cross_source_merge_attestations: not a merge of two declared sources in an open v3 bootstrap');
END;

CREATE TRIGGER promotion_cross_source_merge_attestations_immutable
BEFORE UPDATE ON promotion_cross_source_merge_attestations
BEGIN
  SELECT RAISE(ABORT, 'promotion_cross_source_merge_attestations are immutable');
END;

CREATE TRIGGER promotion_cross_source_merge_attestations_no_delete
BEFORE DELETE ON promotion_cross_source_merge_attestations
BEGIN
  SELECT RAISE(ABORT, 'promotion_cross_source_merge_attestations are immutable');
END;

-- While a v3 bootstrap is open, a redirected spot arrives only as an attested merge's loser or redirected spot,
-- pointing at that merge's survivor.
CREATE TRIGGER promotion_multi_open_spots_merged
BEFORE INSERT ON spots
WHEN NEW.merged_into IS NOT NULL
  AND EXISTS (SELECT 1 FROM promotion_multi_bootstraps) AND NOT EXISTS (SELECT 1 FROM promotion_multi_bootstrap_completions)
  AND NOT EXISTS (SELECT 1 FROM promotion_cross_source_merge_attestations a
    WHERE a.survivor_spot_id = NEW.merged_into
      AND (a.loser_spot_id = NEW.spot_id OR NEW.spot_id IN (SELECT value FROM json_each(a.redirected_spot_ids_json))))
BEGIN
  SELECT RAISE(ABORT, 'spots: a redirect in a v3 bootstrap needs the attested merge it follows');
END;

-- Every applied merge, from the runtime chain or from a bootstrap's attestations.
CREATE VIEW cross_source_merges AS
SELECT survivor_spot_id, loser_spot_id, conflict_hold FROM cross_source_merge_applications
UNION ALL
SELECT survivor_spot_id, loser_spot_id, conflict_hold FROM promotion_cross_source_merge_attestations;

-- Survivors that may not publish: a held merge, or a loser whose semantic values differ from the survivor's now.
-- No source priority picks a value; agreement is the only thing that publishes.
CREATE VIEW cross_source_publication_blocks AS
SELECT DISTINCT m.survivor_spot_id AS spot_id FROM cross_source_merges m
WHERE m.conflict_hold = 1
  OR (SELECT values_json FROM cross_source_spot_values WHERE spot_id = m.survivor_spot_id)
    IS NOT (SELECT values_json FROM cross_source_spot_values WHERE spot_id = m.loser_spot_id);

CREATE TRIGGER tile_snapshot_spots_cross_source_hold
BEFORE INSERT ON tile_snapshot_spots
WHEN EXISTS (SELECT 1 FROM cross_source_publication_blocks b WHERE b.spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'tile_snapshot_spots: spot is held by an unresolved cross-source merge conflict');
END;

-- TEMPORARY SAFETY GATES (ADR-0008 decision 4): one source's removal or relocation never acts alone on a spot that a
-- merge made another source's evidence stand behind. Lifted only by the PR that implements multi-source semantics
-- for those steps.
CREATE TRIGGER review_removal_applications_cross_source_gate
BEFORE INSERT ON review_removal_applications
WHEN EXISTS (SELECT 1 FROM cross_source_merges m WHERE m.survivor_spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'review_removal_applications: the spot is a cross-source merge survivor');
END;

CREATE TRIGGER review_relocation_applications_cross_source_gate
BEFORE INSERT ON review_relocation_applications
WHEN EXISTS (SELECT 1 FROM cross_source_merges m WHERE m.survivor_spot_id = NEW.spot_id)
BEGIN
  SELECT RAISE(ABORT, 'review_relocation_applications: the spot is a cross-source merge survivor');
END;

-- ---------------------------------------------------------------------------------------------------------
-- v3 completion: the attestations arrived as declared, each is reproduced (its loser and survivor carried, the
-- loser redirected), every redirect that arrived is justified by an attested merge, and no runtime cross-source row
-- travelled. A later merge can repoint an earlier merge's redirects (A<-B, then C<-A leaves B -> C), so a loser is
-- required to be redirected, not to point at its own survivor; the 0001 triggers keep every redirect one hop.
-- Separate triggers (D1 expression depth, see 0018). A bundle without merges omits the count key: coalesce keeps 0.
CREATE TRIGGER promotion_multi_bootstrap_completions_valid_cross_source_rows
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN NOT EXISTS (
  SELECT 1 FROM promotion_multi_bootstraps b
  WHERE b.promotion_bootstrap_id = NEW.promotion_bootstrap_id
    AND (SELECT count(*) FROM promotion_cross_source_merge_attestations)
      = coalesce(json_extract(b.expected_rows_json, '$.promotion_cross_source_merge_attestations'), 0))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: cross-source merge attestations do not match the declared count');
END;

CREATE TRIGGER promotion_multi_bootstrap_completions_valid_cross_source_merges
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM promotion_cross_source_merge_attestations a
  WHERE NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = a.loser_spot_id AND s.merged_into IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = a.survivor_spot_id)
    OR EXISTS (SELECT 1 FROM json_each(a.redirected_spot_ids_json) j
      WHERE NOT EXISTS (SELECT 1 FROM spots s WHERE s.spot_id = j.value AND s.merged_into IS NOT NULL)))
  OR EXISTS (SELECT 1 FROM spots s WHERE s.merged_into IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM promotion_cross_source_merge_attestations a WHERE a.survivor_spot_id = s.merged_into
      AND (a.loser_spot_id = s.spot_id OR s.spot_id IN (SELECT value FROM json_each(a.redirected_spot_ids_json)))))
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: a cross-source merge or redirect was not reproduced as attested');
END;

CREATE TRIGGER promotion_multi_bootstrap_completions_valid_cross_source_nothing_else
BEFORE INSERT ON promotion_multi_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM cross_source_candidates) OR EXISTS (SELECT 1 FROM cross_source_decisions)
  OR EXISTS (SELECT 1 FROM cross_source_merge_applications)
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstrap_completions: a bundle carries no runtime cross-source review state');
END;

-- A v2 bundle carries one source and never a merge attestation.
CREATE TRIGGER promotion_bootstrap_completions_no_cross_source
BEFORE INSERT ON promotion_bootstrap_completions
WHEN EXISTS (SELECT 1 FROM promotion_cross_source_merge_attestations) OR EXISTS (SELECT 1 FROM cross_source_candidates)
  OR EXISTS (SELECT 1 FROM cross_source_decisions) OR EXISTS (SELECT 1 FROM cross_source_merge_applications)
BEGIN
  SELECT RAISE(ABORT, 'promotion_bootstrap_completions: a v2 bundle carries no cross-source state');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Empty target: both bootstrap guards name every table, now including 0019's (test/promotion-empty-target.test.ts).
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
BEGIN
  SELECT RAISE(ABORT, 'promotion_multi_bootstraps: a promotion bundle bootstraps only an empty, freshly migrated database');
END;
