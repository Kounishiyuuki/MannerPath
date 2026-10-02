// Approximate area locations (ADR-0017; migration 0030).
//
// Existence and location are separate axes. An approved source can state that a smoking place exists INSIDE a named
// park, station, facility, airport or commercial building without giving the smoking place's own point. Such a spot
// may be pinned at a reviewed, reusable representative anchor of that area and published with
// `verification.locationPrecision = "areaApproximate"`, never as an exact point.
//
//   evaluateAreaApproximate   the fail-closed gate over one candidate. Pure; the nationwide replay uses it too.
//   validateAreaAnchor        a reviewed anchor's own checks (origin, reuse basis, policy, Japan extent).
//   areaAnchorEvidenceSha256  the digest an anchor's review is bound to.
//   recordAreaAnchor          appends one reviewed anchor (0030 area_location_anchors).
//   anchoredObservation       turns an anchor into an observation's coordinate + location provenance.
//   planAreaPrecisionUpgrade  ADR-0017 §6 / ADR-0009: same coordinate -> precision only; any move -> relocation review.
//   applyAreaPrecisionUpgrade ends a binding at the same coordinate (the 0030 trigger re-checks the coordinate).
//
// The host is location context, never existence evidence: nothing here turns a park, station or store into a spot.

import { type Db, sha256Hex } from "../db.ts";
import { withinJapan } from "../geo/japan.ts";
import type { FieldProvenance, SourceObservation } from "./source-adapter.ts";

export const AREA_ANCHOR_POLICY_VERSION = "area-anchor-policy.v1";
export const AREA_APPROXIMATE_GATE_VERSION = "area-approximate-gate.v1";
/** The location-provenance rule written for an anchored observation; the anchor id follows the colon. */
export const AREA_ANCHOR_RULE_PREFIX = "area-anchor.v1:";

export type AreaKind = "park" | "station" | "facility" | "airport" | "commercialBuilding" | "other";
/** What an anchor point is. Both are the publisher's own point for the AREA, never a smoking point. */
export type AnchorOriginKind = "publisherAreaPoint" | "publisherFacilityPoint";
/** Policy v1: the anchor comes from the existence source's own reviewed publication, under its reviewed license. */
export type AnchorReuseBasis = "existenceSourceLicense";

export interface ReviewedAreaAnchor {
  anchorId: string;
  areaName: string;
  areaKind: AreaKind;
  latitude: number;
  longitude: number;
  originKind: AnchorOriginKind;
  originSourceId: string;
  /** Where in the origin publication the point is stated (URL, or file + row reference). */
  originReference: string;
  reuseBasis: AnchorReuseBasis;
  policyVersion: typeof AREA_ANCHOR_POLICY_VERSION;
  reviewedBy: string;
  reviewedOn: string;
}

const FORBIDDEN_ORIGIN = /google|goo\.gl|maps\.apple|openstreetmap|overpass|nominatim|screenshot/i;

/** A reviewed anchor's own checks. Empty means valid. Never consults a map vendor or OSM. */
export function validateAreaAnchor(a: ReviewedAreaAnchor): string[] {
  const problems: string[] = [];
  if (!/^aa_[a-z0-9]+$/.test(a.anchorId) || a.anchorId.length > 64) problems.push("anchorIdInvalid");
  if (a.areaName.trim() === "" || a.areaName.length > 80) problems.push("areaNameInvalid");
  if (a.originKind !== "publisherAreaPoint" && a.originKind !== "publisherFacilityPoint") problems.push("originKindNotReviewed");
  if (FORBIDDEN_ORIGIN.test(a.originReference)) problems.push("forbiddenOrigin");
  if (a.reuseBasis !== "existenceSourceLicense") problems.push("reuseBasisNotReviewed");
  if (a.policyVersion !== AREA_ANCHOR_POLICY_VERSION) problems.push("policyVersionNotReviewed");
  if (a.reviewedBy.trim() === "" || !/^\d{4}-\d{2}-\d{2}$/.test(a.reviewedOn)) problems.push("reviewMissing");
  if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude) || !withinJapan(a.latitude, a.longitude)) problems.push("coordinateInvalid");
  return problems;
}

export async function areaAnchorEvidenceSha256(a: ReviewedAreaAnchor): Promise<string> {
  return sha256Hex(JSON.stringify([
    a.anchorId, a.areaName, a.areaKind, a.latitude, a.longitude, a.originKind, a.originSourceId, a.originReference,
    a.reuseBasis, a.policyVersion, a.reviewedBy, a.reviewedOn,
  ]));
}

/** Appends one reviewed anchor; idempotent for the identical anchor, refuses a changed one under the same id. */
export async function recordAreaAnchor(db: Db, a: ReviewedAreaAnchor, now: string): Promise<void> {
  const problems = validateAreaAnchor(a);
  if (problems.length > 0) throw new Error(`area anchor ${a.anchorId}: ${problems.join(", ")}`);
  const digest = await areaAnchorEvidenceSha256(a);
  const existing = await db.prepare("SELECT evidence_sha256 FROM area_location_anchors WHERE anchor_id = ?")
    .bind(a.anchorId).first<{ evidence_sha256: string }>();
  if (existing) {
    if (existing.evidence_sha256 !== digest) throw new Error(`area anchor ${a.anchorId} was recorded with different evidence; record a new anchor id`);
    return;
  }
  await db.prepare(
    `INSERT INTO area_location_anchors (anchor_id, area_name, area_kind, latitude, longitude, origin_kind, origin_source_id,
       origin_reference, reuse_basis, policy_version, reviewed_by, reviewed_on, evidence_sha256, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(a.anchorId, a.areaName, a.areaKind, a.latitude, a.longitude, a.originKind, a.originSourceId, a.originReference,
    a.reuseBasis, a.policyVersion, a.reviewedBy, a.reviewedOn, digest, now).run();
}

/**
 * The anchored form of an observation: the anchor's coordinate, a `location` provenance row naming the anchor and
 * the record columns that state the area, and the anchor id kept with the observation's claims. The existence
 * provenance must already be present: an anchor never supplies existence.
 */
export function anchoredObservation(
  base: Omit<SourceObservation, "latitude" | "longitude">, anchor: ReviewedAreaAnchor, areaColumns: readonly string[],
): SourceObservation {
  if (!base.provenance.some((p) => p.field === "existence")) {
    throw new Error(`area anchor ${anchor.anchorId}: an anchored observation needs its own existence evidence`);
  }
  const location: FieldProvenance = { field: "location", columns: [...areaColumns], rule: `${AREA_ANCHOR_RULE_PREFIX}${anchor.anchorId}` };
  return {
    ...base,
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    provenance: [...base.provenance.filter((p) => p.field !== "location"), location],
    locationAnchorId: anchor.anchorId,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The gate (pure). Used by tests, by adapters' reviewed mappings and by the nationwide replay.

export interface AreaApproximateCandidate {
  sourcePublication: "approved" | "notApproved";
  /** What the record itself states. `hostOnly`: it names a place/host but states no smoking place there. */
  existenceEvidence: "smokingPlaceStated" | "hostOnly" | "none";
  /** Explicit closure, suspension or prohibition evidence, or a conflict between publications. */
  conflict: "none" | "closed" | "prohibited" | "conflictingPublications";
  /** The smoking place's own point, if the record has one. */
  exactPoint: "present" | "absent";
  /** The area the record places the smoking place in, and whether a reviewed anchor exists for it. */
  area: "named" | "notNamed";
  anchor: "reviewed" | "missing" | "forbiddenOrigin";
}

export type AreaApproximateRejection =
  | "sourceNotApproved" | "noExistenceEvidence" | "hostOnly" | "closedOrProhibited" | "conflictingEvidence"
  | "areaNotNamed" | "noReviewedAnchor" | "forbiddenAnchorOrigin";

export interface AreaApproximateDecision {
  gateVersion: string;
  verdict: "exactPoint" | "areaApproximate" | "rejected";
  rejections: AreaApproximateRejection[];
}

export function evaluateAreaApproximate(c: AreaApproximateCandidate): AreaApproximateDecision {
  const rejections: AreaApproximateRejection[] = [];
  // Existence first: an anchor can never make a host into a smoking place.
  if (c.sourcePublication !== "approved") rejections.push("sourceNotApproved");
  if (c.existenceEvidence === "none") rejections.push("noExistenceEvidence");
  if (c.existenceEvidence === "hostOnly") rejections.push("hostOnly");
  if (c.conflict === "closed" || c.conflict === "prohibited") rejections.push("closedOrProhibited");
  if (c.conflict === "conflictingPublications") rejections.push("conflictingEvidence");
  if (rejections.length === 0 && c.exactPoint === "present") return { gateVersion: AREA_APPROXIMATE_GATE_VERSION, verdict: "exactPoint", rejections };
  // A missing exact point alone is not a rejection; a missing anchor is (nothing honest to draw), the evidence stays.
  if (c.exactPoint === "absent") {
    if (c.area === "notNamed") rejections.push("areaNotNamed");
    else if (c.anchor === "missing") rejections.push("noReviewedAnchor");
    else if (c.anchor === "forbiddenOrigin") rejections.push("forbiddenAnchorOrigin");
  }
  return { gateVersion: AREA_APPROXIMATE_GATE_VERSION, verdict: rejections.length === 0 ? "areaApproximate" : "rejected", rejections };
}

// ---------------------------------------------------------------------------------------------------------------
// Precision upgrade (ADR-0017 §6, ADR-0009). The spot ID never changes.

export interface PrecisionUpgradeInput {
  spot: { latitude: number; longitude: number };
  newPoint: { latitude: number; longitude: number; precision: "publisherPoint" | "communityPinned" | "reviewedDerived" };
  /** Whether a reviewer found the new point inside the original area. Unknown is treated as outside. */
  insideArea: boolean | "unknown";
}

export type PrecisionUpgradePlan =
  | { kind: "precisionOnly"; precision: "publisherPoint" | "communityPinned" }
  | { kind: "relocationReview"; adr: "ADR-0009"; identityReview: boolean }
  | { kind: "refused"; reason: "reviewedDerivedNotApproved" };

export function planAreaPrecisionUpgrade(input: PrecisionUpgradeInput): PrecisionUpgradePlan {
  // ADR-0011 is Proposed: a derived coordinate is never published, so it can never be an upgrade target.
  if (input.newPoint.precision === "reviewedDerived") return { kind: "refused", reason: "reviewedDerivedNotApproved" };
  const same = input.newPoint.latitude === input.spot.latitude && input.newPoint.longitude === input.spot.longitude;
  if (same) return { kind: "precisionOnly", precision: input.newPoint.precision };
  // Any change at all, with no distance threshold, is an ADR-0009 relocation; outside the area also re-reviews identity.
  return { kind: "relocationReview", adr: "ADR-0009", identityReview: input.insideArea !== true };
}

/** Ends the binding as a precision-only upgrade. The 0030 trigger refuses it unless the coordinate is unchanged. */
export async function applyAreaPrecisionUpgrade(
  db: Db, spotId: string, precision: "publisherPoint" | "communityPinned", now: string,
): Promise<void> {
  const active = await db.prepare("SELECT 1 AS n FROM spot_location_anchors WHERE spot_id = ? AND ended_at IS NULL")
    .bind(spotId).first<{ n: number }>();
  if (!active) throw new Error(`spot ${spotId} has no active area anchor`);
  await db.prepare(
    `UPDATE spot_location_anchors SET ended_at = ?, end_reason = 'precisionUpgrade', upgraded_precision = ?
     WHERE spot_id = ? AND ended_at IS NULL`,
  ).bind(now, precision, spotId).run();
}

/**
 * Fails closed before any canonical write unless every anchored observation names a recorded anchor of THIS source
 * (policy v1) at exactly the observation's coordinate, and states the area in its location provenance.
 */
export async function assertAnchorsRecorded(db: Db, sourceId: string, observations: readonly SourceObservation[]): Promise<void> {
  for (const o of observations) {
    const rule = o.provenance.find((p) => p.field === "location")?.rule ?? "";
    const anchoredRule = rule.startsWith(AREA_ANCHOR_RULE_PREFIX);
    if (o.locationAnchorId === undefined) {
      if (anchoredRule) throw new Error(`resolve: an observation cites an area anchor in its provenance but names none`);
      continue;
    }
    if (rule !== `${AREA_ANCHOR_RULE_PREFIX}${o.locationAnchorId}`) {
      throw new Error(`resolve: anchored observation ${o.locationAnchorId} has no matching location provenance`);
    }
    if (!o.provenance.some((p) => p.field === "existence")) {
      throw new Error(`resolve: anchored observation ${o.locationAnchorId} has no existence evidence of its own`);
    }
    const a = await db.prepare("SELECT origin_source_id, latitude, longitude FROM area_location_anchors WHERE anchor_id = ?")
      .bind(o.locationAnchorId).first<{ origin_source_id: string; latitude: number; longitude: number }>();
    if (!a) throw new Error(`resolve: area anchor ${o.locationAnchorId} is not recorded; record its reviewed provenance first`);
    if (a.origin_source_id !== sourceId) throw new Error(`resolve: area anchor ${o.locationAnchorId} is not from source ${sourceId}`);
    if (a.latitude !== o.latitude || a.longitude !== o.longitude) {
      throw new Error(`resolve: area anchor ${o.locationAnchorId} does not match its observation's coordinate`);
    }
  }
}
