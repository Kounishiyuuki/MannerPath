-- Explicit conflict attestations for attenuated canonical fields
-- (ADR-0006 amendment 2026-09, Issue #42, revised after review).
--
-- The first version of the Issue #42 reconciliation recorded the weakening by rewriting the
-- affected field's `spot_field_provenance.rule`. That was dishonest in two ways: the row still
-- pointed at a CSV record and its release's `observed_on`, so the public provenance in
-- `GET /spots/{id}` implied the 2026-08-18 CSV had itself observed a conflict published later on a
-- different page; and it destroyed the record of what the CSV actually stated and by which rule.
--
-- The two facts are now stored separately and both stay true:
--
--   spot_field_provenance   what the source record stated, and the rule that read it. Unchanged.
--   spot_field_attenuations that the canonical claim was then *weakened*, and on what reviewed
--                           evidence. One row per (spot, field, effect).
--
-- Neither table alone explains an attenuated value; the pair does. The public API omits an
-- attenuated field's provenance rather than presenting either half as the whole story
-- (docs/API.md).
--
-- What this table deliberately does NOT hold: any prose, hours, coordinate or other content from
-- the referenced page, and any replacement value. It records that a reviewed conflict exists, which
-- field it touched, which attestation set decided it, where that was read and when, and the exact
-- source release the decision was reviewed against. Nothing here is redistributable page content.

CREATE TABLE spot_field_attenuations (
  spot_id                TEXT NOT NULL REFERENCES spots (spot_id),
  -- Same vocabulary as spot_field_provenance.field, restricted to the fields an attenuation can
  -- touch. A new effect adds its field here in its own migration.
  field                  TEXT NOT NULL CHECK (field IN ('openingHours', 'lifecycle', 'location')),
  -- The weakening that was applied. Every value is subtractive by construction: there is no effect
  -- that writes a value, so a reference that has no reviewed reuse permission can never become one.
  effect                 TEXT NOT NULL CHECK (effect IN ('hoursUnknown', 'temporarilyClosed', 'withholdFromPublication')),
  -- The repository-controlled attestation set that decided this, e.g. 'taito-list-page-conflicts.v1'.
  attestation_version    TEXT NOT NULL,
  -- What kind of thing the conflict was read from. Not a registered source: a source would be in
  -- `sources` and could publish values. This is a reference that can only take claims away.
  reference_kind         TEXT NOT NULL CHECK (reference_kind IN ('publisherWebPage')),
  reference_url          TEXT NOT NULL,
  -- When the reference was last read by a human review, date-time precision.
  checked_at             TEXT NOT NULL,
  -- Fingerprint of the source release the attestation was reviewed against. An import of any other
  -- release must not reuse these decisions: the resolver checks these three values against the
  -- reviewed constants and fails closed (see src/pipeline/taito-list-page.ts).
  release_id             INTEGER NOT NULL REFERENCES source_releases (release_id),
  release_content_sha256 TEXT NOT NULL CHECK (length(release_content_sha256) = 64 AND release_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  release_observed_on    TEXT,
  release_source_url     TEXT NOT NULL,
  resolver_version       TEXT NOT NULL,
  applied_at             TEXT NOT NULL,
  PRIMARY KEY (spot_id, field, effect)
);

CREATE INDEX spot_field_attenuations_spot ON spot_field_attenuations (spot_id);

-- Attenuations are evidence about a published decision, not scratch state: they are never deleted,
-- and correcting one means a new attestation version and a re-resolve. Migration 0006 adds the
-- matching UPDATE guard, which makes the rows append-only.
CREATE TRIGGER spot_field_attenuations_no_delete
BEFORE DELETE ON spot_field_attenuations
BEGIN
  SELECT RAISE(ABORT, 'spot_field_attenuations rows are never deleted; issue a new attestation version instead');
END;
