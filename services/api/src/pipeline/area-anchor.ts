// Approximate area locations (ADR-0017; migration 0030).
//
// Existence and location are separate axes. An approved source can state that a smoking place exists INSIDE a named
// park, station, facility, airport or commercial building without giving the smoking place's own point. Such a spot
// may be pinned at a reviewed anchor of that area and published as `areaApproximate`, never as an exact point.
//
//   evaluateAreaApproximate    the fail-closed gate over one candidate. Pure; the nationwide replay uses it too.
//   validateAreaAnchor         a reviewed anchor's own checks.
//   recordAreaAnchor           appends one reviewed anchor, bound to ONE publication: the release (file) and the record
//                              in it whose values state the area's point, read through the adapter's reviewed
//                              `areaPoint` mapping. The registry's coordinate is checked against that record, never
//                              trusted as typed (no manual pins).
//   anchoredObservation        an anchored observation: the anchor's coordinate and a location provenance naming it.
//   assertAnchorsRecorded      the resolver's fail-closed check before any canonical write.
//   planAreaPrecisionUpgrade   ADR-0017 §6 / ADR-0009 planning (pure).
//   applyAreaPrecisionUpgrade  the only way out of areaApproximate: exact-point evidence + reviewed identity, and an
//                              ADR-0009 relocation application in the same batch when the point moved (0030 triggers).
//
// The host is location context, never existence evidence: nothing here turns a park, station or store into a spot.

import { type Db, type DbStatement, sha256Hex } from "../db.ts";
import { withinJapan } from "../geo/japan.ts";
import { AREA_ANCHOR_RULE_PREFIX } from "../tiles/location-state.ts";
import { rederiveObservation } from "./observe.ts";
import { applyReviewedRelocation } from "./relocation-application.ts";
import { registerAreaPointMapping } from "./area-point-mapping.ts";
import { authorityStatement, latestLocationAuthority } from "./resolve.ts";
import type { FieldProvenance, SourceAdapter, SourceObservation } from "./source-adapter.ts";

export { AREA_ANCHOR_RULE_PREFIX };
export const AREA_ANCHOR_POLICY_VERSION = "area-anchor-policy.v1";
export const AREA_APPROXIMATE_GATE_VERSION = "area-approximate-gate.v1";
export const AREA_PRECISION_UPGRADE_POLICY_VERSION = "area-precision-upgrade.v1";
export const AREA_PRECISION_UPGRADE_EXECUTOR_VERSION = "area-precision-upgrade-application.v1";

export type AreaKind = "park" | "station" | "facility" | "airport" | "commercialBuilding" | "other";
/** What an anchor point is. Both are the publisher's own point for the AREA, never a smoking point. */
export type AnchorOriginKind = "publisherAreaPoint" | "publisherFacilityPoint";
/** Policy v1: the anchor is stated by the same reviewed publication (release) as the existence evidence. */
export type AnchorReuseBasis = "sameReviewedPublication";

export interface ReviewedAreaAnchor {
  anchorId: string;
  areaName: string;
  areaKind: AreaKind;
  latitude: number;
  longitude: number;
  originKind: AnchorOriginKind;
  originSourceId: string;
  /** The publication: one release of the origin source (its content digest) and the publisher's row in it. */
  originReleaseContentSha256: string;
  originUpstreamRowRef: string;
  /** Human-readable pointer (file + row). Not the provenance boundary. */
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
  if (a.reuseBasis !== "sameReviewedPublication") problems.push("reuseBasisNotReviewed");
  if (a.policyVersion !== AREA_ANCHOR_POLICY_VERSION) problems.push("policyVersionNotReviewed");
  if (a.reviewedBy.trim() === "" || !/^\d{4}-\d{2}-\d{2}$/.test(a.reviewedOn)) problems.push("reviewMissing");
  if (!/^[0-9a-f]{64}$/.test(a.originReleaseContentSha256) || a.originUpstreamRowRef === "") problems.push("publicationMissing");
  if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude) || !withinJapan(a.latitude, a.longitude)) problems.push("coordinateInvalid");
  return problems;
}

/**
 * Appends one reviewed anchor; idempotent for the identical anchor, refuses a changed one under the same id. The
 * origin record is looked up by its publication (release digest + publisher row) and must state exactly this area
 * point through the adapter's reviewed `areaPoint` mapping.
 */
export async function recordAreaAnchor(db: Db, adapter: SourceAdapter, a: ReviewedAreaAnchor, now: string): Promise<void> {
  const problems = validateAreaAnchor(a);
  if (problems.length > 0) throw new Error(`area anchor ${a.anchorId}: ${problems.join(", ")}`);
  if (adapter.registry.sourceId !== a.originSourceId) throw new Error(`area anchor ${a.anchorId}: adapter is ${adapter.registry.sourceId}, not ${a.originSourceId}`);
  if (!adapter.areaPoint || !adapter.areaPointColumns) throw new Error(`area anchor ${a.anchorId}: ${a.originSourceId} has no reviewed areaPoint mapping`);
  const record = await db.prepare(
    `SELECT r.record_id, r.release_id, r.raw_values_json, rel.header_json FROM source_records r JOIN source_releases rel ON rel.release_id = r.release_id
     WHERE rel.source_id = ? AND rel.content_sha256 = ? AND r.upstream_row_ref = ?`,
  ).bind(a.originSourceId, a.originReleaseContentSha256, a.originUpstreamRowRef)
    .first<{ record_id: number; release_id: number; raw_values_json: string; header_json: string }>();
  if (!record) throw new Error(`area anchor ${a.anchorId}: row ${a.originUpstreamRowRef} of release ${a.originReleaseContentSha256} is not in this database`);
  const stated = adapter.areaPoint(JSON.parse(record.raw_values_json));
  if (!stated || stated.areaName !== a.areaName || stated.latitude !== a.latitude || stated.longitude !== a.longitude) {
    throw new Error(`area anchor ${a.anchorId}: the publication's row does not state this area point`);
  }
  const digest = await sha256Hex(JSON.stringify([
    a.anchorId, a.areaName, a.areaKind, a.latitude, a.longitude, a.originKind, a.originSourceId, a.originReleaseContentSha256,
    record.raw_values_json, adapter.mappingVersion, a.originReference, a.reuseBasis, a.policyVersion, a.reviewedBy, a.reviewedOn,
  ]));
  const existing = await db.prepare("SELECT evidence_sha256 FROM area_location_anchors WHERE anchor_id = ?")
    .bind(a.anchorId).first<{ evidence_sha256: string }>();
  if (existing) {
    if (existing.evidence_sha256 !== digest) throw new Error(`area anchor ${a.anchorId} was recorded with different evidence; record a new anchor id`);
    return;
  }
  // The point is read through the source's reviewed area-point mapping (0030 area_point_mappings), never through columns
  // this call names.
  await registerAreaPointMapping(db, adapter, now);
  await db.prepare(
    `INSERT INTO area_location_anchors (anchor_id, area_name, area_kind, latitude, longitude, origin_kind, origin_source_id,
       origin_release_id, origin_release_content_sha256, origin_record_id, origin_record_values_json, origin_header_json,
       origin_mapping_version, origin_reference, reuse_basis, policy_version, reviewed_by, reviewed_on, evidence_sha256, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(a.anchorId, a.areaName, a.areaKind, a.latitude, a.longitude, a.originKind, a.originSourceId, record.release_id,
    a.originReleaseContentSha256, record.record_id, record.raw_values_json, record.header_json, adapter.mappingVersion,
    a.originReference, a.reuseBasis, a.policyVersion, a.reviewedBy, a.reviewedOn, digest, now).run();
}

/**
 * The anchored form of an observation: the anchor's coordinate, a `location` provenance row naming the anchor and
 * the record columns that state the area, and the anchor id kept with the observation's claims. The existence
 * provenance must already be present: an anchor never supplies existence.
 */
export function anchoredObservation(
  base: Omit<SourceObservation, "latitude" | "longitude">,
  anchor: Pick<ReviewedAreaAnchor, "anchorId" | "latitude" | "longitude">, areaColumns: readonly string[],
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

/**
 * Fails closed before any canonical write unless every anchored observation names a recorded anchor of THIS source at
 * exactly the observation's coordinate and states it in its location provenance. `newSpotRecordIds` are the records
 * that will create a spot (and so a binding) in this release: anchor policy v1 binds those only to an anchor of this
 * very release. A record that continues an existing spot keeps that spot's binding, so its anchor may be older.
 */
export async function assertAnchorsRecorded(
  db: Db, sourceId: string, releaseId: number, observations: readonly { recordId: number; observation: SourceObservation }[],
  newSpotRecordIds: ReadonlySet<number>,
): Promise<void> {
  for (const { recordId, observation: o } of observations) {
    const rule = o.provenance.find((p) => p.field === "location")?.rule ?? "";
    const anchoredRule = rule.startsWith("area-anchor.");
    if (o.locationAnchorId === undefined) {
      if (anchoredRule) throw new Error(`resolve: record ${recordId} cites an area anchor in its provenance but names none`);
      continue;
    }
    if (rule !== `${AREA_ANCHOR_RULE_PREFIX}${o.locationAnchorId}`) {
      throw new Error(`resolve: anchored record ${recordId} has no matching location provenance`);
    }
    if (!o.provenance.some((p) => p.field === "existence")) {
      throw new Error(`resolve: anchored record ${recordId} has no existence evidence of its own`);
    }
    const a = await db.prepare("SELECT origin_source_id, origin_release_id, latitude, longitude FROM area_location_anchors WHERE anchor_id = ?")
      .bind(o.locationAnchorId).first<{ origin_source_id: string; origin_release_id: number; latitude: number; longitude: number }>();
    if (!a) throw new Error(`resolve: area anchor ${o.locationAnchorId} is not recorded; record its reviewed provenance first`);
    if (a.origin_source_id !== sourceId) throw new Error(`resolve: area anchor ${o.locationAnchorId} is not from source ${sourceId}`);
    if (newSpotRecordIds.has(recordId) && a.origin_release_id !== releaseId) {
      throw new Error(`resolve: area anchor ${o.locationAnchorId} is from another publication than record ${recordId} (anchor policy v1)`);
    }
    if (a.latitude !== o.latitude || a.longitude !== o.longitude) {
      throw new Error(`resolve: area anchor ${o.locationAnchorId} does not match its observation's coordinate`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Precision upgrade (ADR-0017 §6, ADR-0009). The spot ID never changes.

export interface PrecisionUpgradeInput {
  spot: { latitude: number; longitude: number };
  newPoint: { latitude: number; longitude: number; precision: "publisherPoint" | "communityPinned" | "reviewedDerived" };
  /** Whether a reviewer found the new point inside the original area. */
  insideArea: boolean | "unknown";
}

export type PrecisionUpgradePlan =
  | { kind: "sameCoordinate"; precision: "publisherPoint" }
  | { kind: "relocated"; precision: "publisherPoint"; adr: "ADR-0009" }
  | { kind: "refused"; reason: "reviewedDerivedNotApproved" | "communityPinNotSupportedV1" | "outsideAreaNotSupportedV1" };

/**
 * Pure planning. v1 fails closed on: a reviewedDerived target (ADR-0011 Proposed), a community pin (cross-source
 * evidence with its own rights gate, #124), and a point outside or not shown inside the area (needs an identity/area
 * review v1 does not implement). Any coordinate change, however small, is an ADR-0009 relocation.
 */
export function planAreaPrecisionUpgrade(input: PrecisionUpgradeInput): PrecisionUpgradePlan {
  if (input.newPoint.precision === "reviewedDerived") return { kind: "refused", reason: "reviewedDerivedNotApproved" };
  if (input.newPoint.precision === "communityPinned") return { kind: "refused", reason: "communityPinNotSupportedV1" };
  if (input.insideArea !== true) return { kind: "refused", reason: "outsideAreaNotSupportedV1" };
  const same = input.newPoint.latitude === input.spot.latitude && input.newPoint.longitude === input.spot.longitude;
  return same ? { kind: "sameCoordinate", precision: "publisherPoint" } : { kind: "relocated", precision: "publisherPoint", adr: "ADR-0009" };
}

export interface AreaPrecisionUpgradeInput {
  spotId: string;
  /** The record of a later release of the anchor's source that states the place's own point. */
  evidenceRecordId: number;
  /** The ambiguousMatch item whose latest matchedToEntity decision makes that record this spot's entity. */
  identityReviewItemId: number;
  /** Required exactly when the point moved: the held relocationCandidate with its latest relocationConfirmed. */
  relocationReviewItemId?: number;
  targetPrecision: "publisherPoint" | "communityPinned" | "reviewedDerived";
  areaPremise: "insideArea" | "outsideArea" | "unknown";
  reviewedBy: string;
  now: string;
}

export type AreaPrecisionUpgradeResult =
  | { status: "applied"; spotId: string; kind: "sameCoordinate" | "relocated" }
  | { status: "alreadyApplied"; spotId: string };

export class AreaPrecisionUpgradeError extends Error {}

/**
 * Applies one reviewed area→exact upgrade. Every premise is re-checked by the 0030 triggers inside the batch; this code
 * derives the exact point from the evidence observation (re-derived from raw under the adapter's current mapping), so
 * no reviewer types a coordinate. A moved point is applied together with its ADR-0009 relocation application.
 * Idempotent for the identical upgrade; anything else on an upgraded spot is refused.
 */
export async function applyAreaPrecisionUpgrade(db: Db, adapter: SourceAdapter, input: AreaPrecisionUpgradeInput): Promise<AreaPrecisionUpgradeResult> {
  const fail = (why: string) => new AreaPrecisionUpgradeError(`area precision upgrade: spot ${input.spotId}: ${why}`);
  const binding = await db.prepare(
    `SELECT b.anchor_id, a.latitude, a.longitude, a.origin_source_id, s.latitude AS spot_latitude, s.longitude AS spot_longitude
     FROM spot_location_anchors b JOIN area_location_anchors a ON a.anchor_id = b.anchor_id JOIN spots s ON s.spot_id = b.spot_id
     WHERE b.spot_id = ?`,
  ).bind(input.spotId).first<{ anchor_id: string; latitude: number; longitude: number; origin_source_id: string; spot_latitude: number; spot_longitude: number }>();
  if (!binding) throw fail("is not pinned at an area anchor");
  if (binding.origin_source_id !== adapter.registry.sourceId) throw fail(`its anchor is from ${binding.origin_source_id}, not ${adapter.registry.sourceId}`);
  const evidence = await rederiveObservation(db, adapter, input.evidenceRecordId).catch((e: Error) => { throw fail(e.message); });
  const location = evidence.observation.provenance.find((p) => p.field === "location");
  if (evidence.observation.locationAnchorId !== undefined || !location || location.rule.startsWith("area-anchor.")) {
    throw fail(`record ${input.evidenceRecordId} does not state an exact point of its own`);
  }
  const plan = planAreaPrecisionUpgrade({
    spot: { latitude: binding.latitude, longitude: binding.longitude },
    newPoint: { latitude: evidence.observation.latitude, longitude: evidence.observation.longitude, precision: input.targetPrecision },
    insideArea: input.areaPremise === "insideArea" ? true : input.areaPremise === "outsideArea" ? false : "unknown",
  });
  if (plan.kind === "refused") throw fail(plan.reason);
  if ((plan.kind === "relocated") !== (input.relocationReviewItemId !== undefined)) {
    throw fail(plan.kind === "relocated" ? "the exact point moved: an ADR-0009 relocation item is required" : "the point did not move: no relocation item applies");
  }
  const release = await db.prepare("SELECT content_sha256 FROM source_releases WHERE release_id = ?").bind(evidence.releaseId).first<{ content_sha256: string }>();
  const identity = await db.prepare("SELECT max(review_decision_id) AS id FROM review_decisions WHERE review_item_id = ?")
    .bind(input.identityReviewItemId).first<{ id: number | null }>();
  const relocationDecision = input.relocationReviewItemId === undefined ? null
    : (await db.prepare("SELECT max(review_decision_id) AS id FROM review_decisions WHERE review_item_id = ?")
      .bind(input.relocationReviewItemId).first<{ id: number | null }>())?.id ?? null;
  if (!release || identity?.id == null) throw fail("its evidence release or identity decision is missing");
  const values = [
    input.spotId, binding.anchor_id, plan.kind, plan.precision, "insideArea", adapter.registry.sourceId, evidence.releaseId,
    release.content_sha256, input.evidenceRecordId, evidence.observationId, adapter.mappingVersion, location.rule,
    JSON.stringify(location.columns), binding.latitude, binding.longitude, evidence.observation.latitude, evidence.observation.longitude,
    input.identityReviewItemId, identity.id, input.relocationReviewItemId ?? null, relocationDecision, input.reviewedBy,
    AREA_PRECISION_UPGRADE_POLICY_VERSION, AREA_PRECISION_UPGRADE_EXECUTOR_VERSION,
  ];
  const existing = await db.prepare("SELECT * FROM area_precision_upgrades WHERE spot_id = ?").bind(input.spotId).first<Record<string, unknown>>();
  if (existing) {
    const same = existing.evidence_observation_id === evidence.observationId && existing.identity_review_decision_id === identity.id
      && existing.relocation_review_decision_id === relocationDecision;
    if (same) return { status: "alreadyApplied", spotId: input.spotId };
    throw fail("was already upgraded on other evidence");
  }
  const upgrade: DbStatement = db.prepare(
    `INSERT INTO area_precision_upgrades (spot_id, anchor_id, upgrade_kind, target_precision, area_premise, evidence_source_id,
       evidence_release_id, evidence_release_content_sha256, evidence_record_id, evidence_observation_id, evidence_mapping_version,
       evidence_location_rule, evidence_location_columns_json, old_latitude, old_longitude, new_latitude, new_longitude,
       identity_review_item_id, identity_review_decision_id, relocation_review_item_id, relocation_review_decision_id,
       reviewed_by, policy_version, executor_version, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(...values, input.now);
  // The upgrade's evidence becomes the spot's current location authority (0030 checks it equals the upgrade exactly).
  const latest = await latestLocationAuthority(db, input.spotId);
  if (!latest || latest.precision !== "areaApproximate") throw fail("its current location authority is not its area anchor");
  const authority = authorityStatement(db, adapter, {
    spotId: input.spotId, seq: latest.seq + 1, kind: "exactUpgrade", precision: plan.precision, anchorId: binding.anchor_id,
    sourceId: adapter.registry.sourceId, releaseId: evidence.releaseId, releaseSha: release.content_sha256, record: evidence,
    now: input.now,
  });
  if (plan.kind === "sameCoordinate") {
    await db.batch([upgrade, ...authority]);
    return { status: "applied", spotId: input.spotId, kind: "sameCoordinate" };
  }
  // The move is the ADR-0009 application; the upgrade row precedes it in the same batch, so the anchored-pin trigger
  // lets exactly this reviewed move through and nothing else.
  const item = await db.prepare("SELECT details_json FROM review_items WHERE review_item_id = ? AND kind = 'relocationCandidate'")
    .bind(input.relocationReviewItemId).first<{ details_json: string }>();
  if (!item) throw fail(`item ${input.relocationReviewItemId} is not a relocationCandidate`);
  const details = JSON.parse(item.details_json) as { previousObservationId?: unknown; newObservationId?: unknown };
  // The delta admits exactly this location-evidence change into the ADR-0009 premise (0030 re-checks it on insert).
  const delta = db.prepare(
    `INSERT INTO area_anchor_relocation_deltas (review_item_id, spot_id, anchor_id, previous_observation_id, new_observation_id, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(input.relocationReviewItemId, input.spotId, binding.anchor_id, details.previousObservationId ?? null, details.newObservationId ?? null, input.now);
  const result = await applyReviewedRelocation(db, adapter, input.relocationReviewItemId!, { now: input.now, prepend: [delta, upgrade, ...authority], areaAnchorDelta: true });
  if (result.status !== "applied") throw fail(`its relocation is ${result.status}`);
  return { status: "applied", spotId: input.spotId, kind: "relocated" };
}
