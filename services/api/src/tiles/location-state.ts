// The one place that decides a published spot's location precision from canonical state (ADR-0017, migration 0030).
// Tile publication, spot detail, the quality report and promotion v2/v3/v4 validation all read the same columns
// (LOCATION_STATE_COLUMNS / LOCATION_STATE_JOINS) and call `locationState`, so they cannot disagree.
//
// The invariant is bidirectional:
//   - a spot with an anchor binding and no upgrade is areaApproximate ONLY IF its location provenance is exactly that
//     anchor's rule, from the anchor's own source, at exactly the anchor's coordinate, within the anchor's publication;
//   - a spot with an upgrade is exact ONLY IF its location provenance is exactly the upgrade's exact-point evidence, at
//     the upgrade's coordinate, and the upgrade belongs to its binding;
//   - an area-anchor location rule without its binding, an upgrade without a binding, or any mismatch is `invalid`:
//     never published, never served, refused by promotion.
// Nothing is inferred: a binding alone never makes a spot exact; the upgrade row is the authority for that.

export const AREA_ANCHOR_RULE_PREFIX = "area-anchor.v1:";

export interface LocationStateRow {
  latitude: number;
  longitude: number;
  location_rule?: string | null;
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
  lu_source_id?: string | null;
  lu_rule?: string | null;
  lu_latitude?: number | null;
  lu_longitude?: number | null;
}

export type AreaKind = "park" | "station" | "facility" | "airport" | "commercialBuilding" | "other";
export type LocationState =
  | { kind: "unanchored" }
  | { kind: "areaApproximate"; area: { name: string; kind: AreaKind } }
  | { kind: "upgraded"; precision: "publisherPoint" }
  | { kind: "invalid"; reason: string };

/** Columns every reader selects, for a query whose spot alias is `s`. */
export const LOCATION_STATE_COLUMNS = `lp.rule AS location_rule,
  (SELECT lrel.source_id FROM source_records lrec JOIN source_releases lrel ON lrel.release_id = lrec.release_id
   WHERE lrec.record_id = lp.record_id) AS location_source_id,
  lb.anchor_id AS lb_anchor_id, lb.record_release_content_sha256 AS lb_release_sha256,
  la.anchor_id AS la_anchor_id, la.origin_source_id AS la_source_id, la.latitude AS la_latitude, la.longitude AS la_longitude,
  la.area_name AS la_area_name, la.area_kind AS la_area_kind, la.origin_release_content_sha256 AS la_release_sha256,
  lu.anchor_id AS lu_anchor_id, lu.target_precision AS lu_precision, lu.evidence_source_id AS lu_source_id,
  lu.evidence_location_rule AS lu_rule, lu.new_latitude AS lu_latitude, lu.new_longitude AS lu_longitude`;

export const LOCATION_STATE_JOINS = `LEFT JOIN spot_field_provenance lp ON lp.spot_id = s.spot_id AND lp.field = 'location'
  LEFT JOIN spot_location_anchors lb ON lb.spot_id = s.spot_id
  LEFT JOIN area_location_anchors la ON la.anchor_id = lb.anchor_id
  LEFT JOIN area_precision_upgrades lu ON lu.spot_id = s.spot_id`;

const AREA_KINDS = new Set(["park", "station", "facility", "airport", "commercialBuilding", "other"]);

export function locationState(r: LocationStateRow): LocationState {
  const rule = r.location_rule ?? null;
  const anchorRule = rule !== null && rule.startsWith("area-anchor.");
  const bound = (r.lb_anchor_id ?? null) !== null;
  const upgraded = (r.lu_anchor_id ?? null) !== null;
  const invalid = (reason: string): LocationState => ({ kind: "invalid", reason });
  if (!bound) {
    if (upgraded) return invalid("upgradeWithoutBinding");
    if (anchorRule) return invalid("anchorRuleWithoutBinding");
    return { kind: "unanchored" };
  }
  if (r.la_anchor_id !== r.lb_anchor_id) return invalid("anchorMissing");
  if (r.lb_release_sha256 !== r.la_release_sha256) return invalid("bindingOutsideAnchorPublication");
  if (!upgraded) {
    if (rule !== `${AREA_ANCHOR_RULE_PREFIX}${r.lb_anchor_id}`) return invalid("activeBindingWithoutItsAnchorRule");
    if (r.location_source_id !== r.la_source_id) return invalid("locationEvidenceFromAnotherSource");
    if (r.latitude !== r.la_latitude || r.longitude !== r.la_longitude) return invalid("coordinateIsNotTheAnchor");
    if (!r.la_area_name || !AREA_KINDS.has(r.la_area_kind ?? "")) return invalid("anchorAreaInvalid");
    return { kind: "areaApproximate", area: { name: r.la_area_name, kind: r.la_area_kind as AreaKind } };
  }
  if (r.lu_anchor_id !== r.lb_anchor_id) return invalid("upgradeOfAnotherAnchor");
  if (anchorRule || rule !== r.lu_rule) return invalid("upgradeWithoutItsExactEvidence");
  if (r.location_source_id !== r.lu_source_id) return invalid("locationEvidenceFromAnotherSource");
  if (r.latitude !== r.lu_latitude || r.longitude !== r.lu_longitude) return invalid("coordinateIsNotTheExactPoint");
  if (r.lu_precision !== "publisherPoint") return invalid("upgradePrecisionNotSupported");
  return { kind: "upgraded", precision: "publisherPoint" };
}
