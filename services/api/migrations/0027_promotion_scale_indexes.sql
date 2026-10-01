-- DATA_DB only. The v3 completion guard counts per-source record/entity links across
-- additive releases. Without a release-leading index SQLite scans every link and
-- re-evaluates the correlated declared-release set for each row (quadratic).
-- These indexes retain every completion/publication/privacy guard unchanged.
CREATE INDEX source_record_entities_release ON source_record_entities (release_id);
CREATE INDEX promotion_review_match_attestations_release ON promotion_review_match_attestations (release_id);
CREATE INDEX promotion_multi_additive_source ON promotion_multi_bootstrap_additive_releases (source_id);
