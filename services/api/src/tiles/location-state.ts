// The one place that decides a published spot's location precision from canonical state (ADR-0017, migration 0030).
// Tile publication, spot detail, the quality report and promotion v2/v3/v4 validation all read the same columns
// (LOCATION_STATE_COLUMNS / LOCATION_STATE_JOINS) and call `locationState`, so they cannot disagree.
//
// The invariant is bidirectional:
//   - a spot that was ever area-anchored has a location authority chain (0030 spot_location_authorities). Its published
//     location evidence (record, rule, columns, source) and coordinate must be EXACTLY the chain's latest row — the
//     anchor, the reviewed exact upgrade, a later reviewed ADR-0009 relocation or an unchanged continuation;
//   - approximate authority: also exactly the binding's anchor point and anchor rule, and no upgrade;
//   - exact authority: also a reviewed upgrade of that binding as history (the first exact authority);
//   - an anchor rule, binding or upgrade without a chain, or any mismatch, is `invalid`: never published, never served,
//     refused by promotion.
//   - the latest authority is itself checked against the evidence that exists NOW (review F1): its release (source and
//     digest), its record in that release, and its observation (record, release, source, mapping, coordinate, anchor
//     claim, location rule and columns) — or, in a promoted database, the carried evidence attestation for that
//     observation — and the record is still linked to one of the spot's own entities. Evidence rewritten underneath an unchanged authority is `invalid`.
// Nothing is inferred from a binding, an upgrade or a source alone; the latest authority row decides.

export const AREA_ANCHOR_RULE_PREFIX = "area-anchor.v1:";

export interface LocationStateRow {
  latitude: number;
  longitude: number;
  location_rule?: string | null;
  location_record_id?: number | null;
  location_columns_json?: string | null;
  location_source_id?: string | null;
  lb_anchor_id?: string | null;
  lb_release_sha256?: string | null;
  la_anchor_id?: string | null;
  la_source_id?: string | null;
  la_latitude?: number | null;
  la_longitude?: number | null;
  la_area_name?: string | null;
  la_area_kind?: string | null;
  la_release_sha256?: string | null;
  lu_anchor_id?: string | null;
  lu_precision?: string | null;
  /** The LATEST row of the spot's location authority chain (0030 spot_location_authorities). */
  lau_precision?: string | null;
  lau_anchor_id?: string | null;
  lau_source_id?: string | null;
  lau_record_id?: number | null;
  lau_rule?: string | null;
  lau_columns_json?: string | null;
  lau_latitude?: number | null;
  lau_longitude?: number | null;
  /** 1 when the latest authority equals the evidence that exists now (release, record, observation or attestation). */
  lau_evidence_ok?: number | null;
}

export type AreaKind = "park" | "station" | "facility" | "airport" | "commercialBuilding" | "other";
export type LocationState =
  | { kind: "unanchored" }
  | { kind: "areaApproximate"; area: { name: string; kind: AreaKind } }
  | { kind: "upgraded"; precision: "publisherPoint" }
  | { kind: "invalid"; reason: string };

/** Columns every reader selects, for a query whose spot alias is `s`. */
export const LOCATION_STATE_COLUMNS = `lp.rule AS location_rule, lp.record_id AS location_record_id, lp.source_columns_json AS location_columns_json,
  (SELECT lrel.source_id FROM source_records lrec JOIN source_releases lrel ON lrel.release_id = lrec.release_id
   WHERE lrec.record_id = lp.record_id) AS location_source_id,
  lb.anchor_id AS lb_anchor_id, lb.record_release_content_sha256 AS lb_release_sha256,
  la.anchor_id AS la_anchor_id, la.origin_source_id AS la_source_id, la.latitude AS la_latitude, la.longitude AS la_longitude,
  la.area_name AS la_area_name, la.area_kind AS la_area_kind, la.origin_release_content_sha256 AS la_release_sha256,
  lu.anchor_id AS lu_anchor_id, lu.target_precision AS lu_precision,
  lau.precision AS lau_precision, lau.anchor_id AS lau_anchor_id, lau.evidence_source_id AS lau_source_id,
  lau.evidence_record_id AS lau_record_id, lau.location_rule AS lau_rule, lau.location_columns_json AS lau_columns_json,
  lau.latitude AS lau_latitude, lau.longitude AS lau_longitude,
  CASE
    WHEN lau.spot_id IS NULL THEN NULL
    WHEN lrel.release_id IS NULL OR lrel.source_id IS NOT lau.evidence_source_id
      OR lrel.content_sha256 IS NOT lau.evidence_release_content_sha256 THEN 0
    WHEN NOT EXISTS (SELECT 1 FROM source_records lrec WHERE lrec.record_id = lau.evidence_record_id AND lrec.release_id = lau.evidence_release_id) THEN 0
    WHEN NOT EXISTS (SELECT 1 FROM source_record_entities lre JOIN spot_source_entities lse ON lse.source_entity_id = lre.source_entity_id
      WHERE lre.record_id = lau.evidence_record_id AND lre.release_id = lau.evidence_release_id AND lse.spot_id = s.spot_id) THEN 0
    WHEN le.observation_id IS NOT NULL THEN (le.source_id = lau.evidence_source_id AND le.release_id = lau.evidence_release_id
      AND le.release_content_sha256 = lau.evidence_release_content_sha256 AND le.record_id = lau.evidence_record_id
      AND le.mapping_version = lau.mapping_version AND le.location_rule = lau.location_rule
      AND le.location_columns_json = lau.location_columns_json AND le.latitude = lau.latitude AND le.longitude = lau.longitude
      AND le.anchor_id IS (CASE WHEN lau.precision = 'areaApproximate' THEN lau.anchor_id END))
    WHEN lo.observation_id IS NOT NULL THEN (lo.record_id = lau.evidence_record_id AND lo.release_id = lau.evidence_release_id
      AND lo.source_id = lau.evidence_source_id AND lo.mapping_version = lau.mapping_version
      AND lo.latitude = lau.latitude AND lo.longitude = lau.longitude
      AND json_extract(lo.claims_json, '$.locationAnchorId') IS (CASE WHEN lau.precision = 'areaApproximate' THEN lau.anchor_id END)
      AND EXISTS (SELECT 1 FROM json_each(lo.field_provenance_json) lp2 WHERE json_extract(lp2.value, '$.field') = 'location'
        AND json_extract(lp2.value, '$.rule') = lau.location_rule
        AND json(json_extract(lp2.value, '$.columns')) = json(lau.location_columns_json)))
    ELSE 0
  END AS lau_evidence_ok`;

export const LOCATION_STATE_JOINS = `LEFT JOIN spot_field_provenance lp ON lp.spot_id = s.spot_id AND lp.field = 'location'
  LEFT JOIN spot_location_anchors lb ON lb.spot_id = s.spot_id
  LEFT JOIN area_location_anchors la ON la.anchor_id = lb.anchor_id
  LEFT JOIN area_precision_upgrades lu ON lu.spot_id = s.spot_id
  LEFT JOIN spot_location_authorities lau ON lau.spot_id = s.spot_id
    AND lau.seq = (SELECT max(seq) FROM spot_location_authorities WHERE spot_id = s.spot_id)
  LEFT JOIN source_releases lrel ON lrel.release_id = lau.evidence_release_id
  LEFT JOIN promotion_location_evidence_attestations le ON le.observation_id = lau.evidence_observation_id
  LEFT JOIN source_observations lo ON lo.observation_id = lau.evidence_observation_id`;

const AREA_KINDS = new Set(["park", "station", "facility", "airport", "commercialBuilding", "other"]);

export function locationState(r: LocationStateRow): LocationState {
  const rule = r.location_rule ?? null;
  const anchorRule = rule !== null && rule.startsWith("area-anchor.");
  const bound = (r.lb_anchor_id ?? null) !== null;
  const upgraded = (r.lu_anchor_id ?? null) !== null;
  const chained = (r.lau_anchor_id ?? null) !== null;
  const invalid = (reason: string): LocationState => ({ kind: "invalid", reason });
  if (!chained) {
    if (bound || upgraded) return invalid("anchorStateWithoutAuthority");
    if (anchorRule) return invalid("anchorRuleWithoutAuthority");
    return { kind: "unanchored" };
  }
  if (!bound || r.la_anchor_id !== r.lb_anchor_id || r.lau_anchor_id !== r.lb_anchor_id) return invalid("authorityWithoutItsBinding");
  if (r.lb_release_sha256 !== r.la_release_sha256) return invalid("bindingOutsideAnchorPublication");
  // The current authority must still be exactly the evidence that exists now (F1).
  if (Number(r.lau_evidence_ok) !== 1) return invalid("authorityEvidenceNotCurrent");
  // The current authority is exact: the published location evidence must be exactly it.
  if (r.location_record_id !== r.lau_record_id || rule !== r.lau_rule || r.location_columns_json !== r.lau_columns_json) {
    return invalid("locationEvidenceIsNotTheCurrentAuthority");
  }
  if (r.location_source_id !== r.lau_source_id || r.lau_source_id !== r.la_source_id) return invalid("locationEvidenceFromAnotherSource");
  if (r.latitude !== r.lau_latitude || r.longitude !== r.lau_longitude) return invalid("coordinateIsNotTheCurrentAuthority");
  if (r.lau_precision === "areaApproximate") {
    if (upgraded) return invalid("approximateAuthorityAfterUpgrade");
    if (rule !== `${AREA_ANCHOR_RULE_PREFIX}${r.lb_anchor_id}`) return invalid("activeBindingWithoutItsAnchorRule");
    if (r.latitude !== r.la_latitude || r.longitude !== r.la_longitude) return invalid("coordinateIsNotTheAnchor");
    if (!r.la_area_name || !AREA_KINDS.has(r.la_area_kind ?? "")) return invalid("anchorAreaInvalid");
    return { kind: "areaApproximate", area: { name: r.la_area_name, kind: r.la_area_kind as AreaKind } };
  }
  if (r.lau_precision !== "publisherPoint" || anchorRule) return invalid("authorityPrecisionNotSupported");
  // The first exact authority is a reviewed upgrade, kept as history: an exact chain without one is not explained.
  if (!upgraded || r.lu_anchor_id !== r.lb_anchor_id || r.lu_precision !== "publisherPoint") return invalid("exactAuthorityWithoutReviewedUpgrade");
  return { kind: "upgraded", precision: "publisherPoint" };
}
