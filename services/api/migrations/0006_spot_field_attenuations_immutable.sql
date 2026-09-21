-- Make spot_field_attenuations fully immutable (ADR-0006, Issue #42 amendment).
--
-- 0005 already refuses DELETE. An UPDATE was still possible, which would let a reviewer silently
-- repoint an applied weakening at another attestation version, another reference or another release
-- fingerprint — the exact provenance laundering the separate attenuation table exists to prevent.
-- These rows are evidence about a published decision, so they are append-only: correcting one means
-- a new attestation version and a re-resolve, which writes new rows.
--
-- A new trigger only; the table and its DELETE guard are unchanged, so no rebuild is needed.

CREATE TRIGGER spot_field_attenuations_no_update
BEFORE UPDATE ON spot_field_attenuations
BEGIN
  SELECT RAISE(ABORT, 'spot_field_attenuations rows are immutable; issue a new attestation version and re-resolve instead');
END;
