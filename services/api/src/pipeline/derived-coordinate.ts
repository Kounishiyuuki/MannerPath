// Derived coordinates from official addresses (ADR-0011, status Proposed; migration 0022). Foundation only.
//
// Existence and position are separate evidence. An approved official source says a smoking place exists at a
// publisher-supplied address; a reviewed, locally run, version-pinned geocoder only estimates where that address
// is. The geocoder is never existence evidence: a candidate without official smoking-place evidence is rejected
// before its geocode is looked at, and nothing here reads a host POI, map vendor (Google, MapKit) or OSM.
//
//   evaluateDerivedCoordinate      the fail-closed gate over one address + one geocode run. Pure.
//   derivedCoordinateEvidenceSha256 the digest a review is bound to; a changed rerun is different evidence.
//   recordDerivedGeocode / recordDerivedReview  append-only persistence (migration 0022).
//   derivedPublicationDecision     whether a gated, reviewed geocode could publish. While ADR-0011's publication
//                                  policy is not approved it never can, whatever the review says.
//   planPublisherCoordinateReplacement  a later publisher coordinate replaces a derived one only as a reviewed
//                                  relocation (ADR-0009: every coordinate change is reviewed, no threshold).
//
// Nothing in this module writes spots, field provenance or tiles.

import { type Db, sha256Hex } from "../db.ts";
import { withinJapan } from "../geo/japan.ts";
import { haversineMeters } from "../geo/distance.ts";

export const DERIVED_COORDINATE_GATE_VERSION = "derived-coordinate-gate.v1";

/**
 * ADR-0011's publication policy. `proposed` means derived coordinates may be generated, gated and reviewed
 * locally but never published. Changing this to `approved` is a maintainer decision made in a reviewed change
 * that also amends ADR-0011, DATA_POLICY.md and the resolver; it is not a configuration knob.
 */
export const DERIVED_COORDINATE_PUBLICATION_POLICY = { status: "proposed", adr: "ADR-0011" } as const;
export type DerivedCoordinatePolicy = { readonly status: "proposed" | "approved" };

/** How a published location would be labelled if the policy were approved. Clients treat unknown values as non-official. */
export const PROPOSED_EVIDENCE_QUALITY = "officialListingDerivedLocation";
export type CoordinateOrigin = "publisher" | "derivedGeocode";

/** abr-geocoder's MatchLevel vocabulary (src/domain/types/geocode/match-level.ts, v2.3.1), verbatim. */
export const ABR_LEVELS = [
  "error", "unknown", "prefecture", "city", "machiaza", "machiaza_detail", "residential_block", "residential_detail", "parcel",
] as const;
export type AbrLevel = (typeof ABR_LEVELS)[number];

/**
 * MannerPath precision, from the provider's coordinate_level (not match_level: a result can match a house number
 * yet carry only a town representative point). residential_detail is the 住居表示 基礎番号 representative point;
 * residential_block a 街区 point; parcel a 地番 lot representative point (a large lot such as a park can be far from
 * the place). Anything coarser is `insufficient` and can never publish.
 */
export type DerivedPrecision = "residentialDetail" | "residentialBlock" | "parcel" | "insufficient";
export function precisionOf(coordinateLevel: AbrLevel): DerivedPrecision {
  switch (coordinateLevel) {
    case "residential_detail": return "residentialDetail";
    case "residential_block": return "residentialBlock";
    case "parcel": return "parcel";
    default: return "insufficient";
  }
}

export interface ReviewedGeocoder {
  readonly geocoderId: string;
  /** Exactly the versions reviewed. Any other version is stale or unreviewed and fails closed. */
  readonly versions: readonly string[];
  /** Dataset content digests a maintainer pinned. Empty: no dataset is pinned yet, so every run fails closed. */
  readonly datasetReleases: readonly string[];
  readonly softwareLicense: string;
  readonly dataLicenses: Readonly<Record<DerivedPrecision, readonly string[]>>;
}

// Reviewed 2026-10-01 against the npm package @digital-go-jp/abr-geocoder@2.3.1 and デジタル庁's ABR terms (ADR-0011).
// No dataset release is pinned in the repository: pinning one is part of the reviewed setup, not of this change.
export const REVIEWED_GEOCODERS: readonly ReviewedGeocoder[] = [{
  geocoderId: "abr-geocoder",
  versions: ["2.3.1"],
  datasetReleases: [],
  softwareLicense: "MIT",
  dataLicenses: {
    residentialDetail: ["公共データ利用規約（第1.0版） アドレス・ベース・レジストリ（デジタル庁）"],
    residentialBlock: ["公共データ利用規約（第1.0版） アドレス・ベース・レジストリ（デジタル庁）"],
    parcel: ["公共データ利用規約（第1.0版） アドレス・ベース・レジストリ（デジタル庁）", "登記所備付地図データ利用規約（法務省）"],
    insufficient: ["公共データ利用規約（第1.0版） アドレス・ベース・レジストリ（デジタル庁）"],
  },
}];

/** One geocoder run's output, as the local geocoder printed it (abrg `-f json`). */
export interface GeocodeRun {
  geocoderId: string;
  geocoderVersion: string;
  /** Options that change results. `fuzzy` must be null: a wildcard match is a guess. */
  options: { target: "all" | "residential" | "parcel"; fuzzy: string | null };
  datasetReleaseId: string;
  input: string;
  output: string | null;
  others: string[];
  score: number | null;
  matchLevel: AbrLevel;
  coordinateLevel: AbrLevel;
  latitude: number | null;
  longitude: number | null;
  srid: string | null;
  lgCode: string | null;
  pref: string | null;
  city: string | null;
  ward: string | null;
  /** Distinct candidates the harness saw for this input; abr-geocoder prints its single best, so 1 or 0. */
  candidateCount: number;
}

export interface DerivedCoordinateInput {
  source: {
    sourceId: string;
    publicationStatus: "approved" | "blocked";
    /** What the source itself says about this row. Only an official smoking place/ashtray listing counts. */
    existenceEvidence: "officialSmokingPlace" | "hostFacility" | "none";
    currentOperation: "confirmed" | "unknown" | "suspended" | "closed";
    /** Whether the reviewed source terms cover reusing the address field itself. */
    addressReuse: "reviewed" | "unknown" | "forbidden";
  };
  record: {
    recordId: number;
    addressColumn: string;
    officialAddress: string;
    addressSuppliedBy: "publisher" | "other";
    /** Named rule that turned officialAddress into the geocoder input; `verbatim` or a reviewed rule. */
    inputRule: string;
    expectedPrefecture: string;
    /** 市区町村 as published, e.g. 千代田区, 札幌市 or 札幌市中央区. */
    expectedMunicipality: string;
  };
  geocode: GeocodeRun | null;
  /** Runs of other reviewed geocoders/datasets over the same address. Any disagreement fails closed. */
  secondOpinions?: GeocodeRun[];
}

export type DerivedRejection =
  | "sourceNotApproved" | "notOfficialSmokingPlace" | "currentOperationNotConfirmed" | "addressNotPublisherSupplied"
  | "addressReuseNotReviewed" | "inputRuleNotReviewed" | "noGeocodeResult" | "geocoderNotReviewed" | "geocoderVersionNotReviewed"
  | "datasetReleaseNotPinned" | "fuzzyMatching" | "multipleCandidates" | "noExactMatch" | "unmatchedRemainder"
  | "normalizationChangedMeaning" | "precisionTooLow" | "coordinateCoarserThanMatch" | "noCoordinate" | "coordinateInvalid"
  | "jurisdictionMismatch" | "geocoderDisagreement";

/** Only the verbatim publisher value is reviewed input. Any rewrite is a meaning change until a rule is reviewed. */
export const REVIEWED_INPUT_RULES = ["verbatim"] as const;

export interface DerivedCoordinateEvaluation {
  gateVersion: string;
  verdict: "rejected" | "reviewRequired" | "candidate";
  rejections: DerivedRejection[];
  precision: DerivedPrecision;
  coordinateOrigin: "derivedGeocode";
  /** Always false here: publication additionally needs an approved review AND an approved policy. */
  publishable: false;
  coordinate: { latitude: number; longitude: number } | null;
  dataLicenses: readonly string[];
}

// A derived coordinate outside Japan is a geocoder failure, whatever the level says.

function jurisdictionMatches(run: GeocodeRun, record: DerivedCoordinateInput["record"]): boolean {
  if (run.pref !== record.expectedPrefecture || run.city === null) return false;
  const municipality = `${run.city}${run.ward ?? ""}`;
  return run.city === record.expectedMunicipality || municipality === record.expectedMunicipality;
}

export function evaluateDerivedCoordinate(
  input: DerivedCoordinateInput,
  geocoders: readonly ReviewedGeocoder[] = REVIEWED_GEOCODERS,
): DerivedCoordinateEvaluation {
  const rejections: DerivedRejection[] = [];
  const { source, record, geocode: run } = input;
  // Existence first: the geocoder can never make a non-smoking row into a spot.
  if (source.publicationStatus !== "approved") rejections.push("sourceNotApproved");
  if (source.existenceEvidence !== "officialSmokingPlace") rejections.push("notOfficialSmokingPlace");
  if (source.currentOperation !== "confirmed") rejections.push("currentOperationNotConfirmed");
  if (record.addressSuppliedBy !== "publisher") rejections.push("addressNotPublisherSupplied");
  if (source.addressReuse !== "reviewed") rejections.push("addressReuseNotReviewed");
  if (!(REVIEWED_INPUT_RULES as readonly string[]).includes(record.inputRule)) rejections.push("inputRuleNotReviewed");

  const reviewed = run === null ? undefined : geocoders.find((g) => g.geocoderId === run.geocoderId);
  let precision: DerivedPrecision = "insufficient";
  let coordinate: DerivedCoordinateEvaluation["coordinate"] = null;
  if (run === null) {
    rejections.push("noGeocodeResult");
  } else {
    if (reviewed === undefined) rejections.push("geocoderNotReviewed");
    else {
      if (!reviewed.versions.includes(run.geocoderVersion)) rejections.push("geocoderVersionNotReviewed");
      if (!reviewed.datasetReleases.includes(run.datasetReleaseId)) rejections.push("datasetReleaseNotPinned");
    }
    if (run.options.fuzzy !== null) rejections.push("fuzzyMatching");
    if (run.candidateCount !== 1) rejections.push(run.candidateCount > 1 ? "multipleCandidates" : "noExactMatch");
    if (run.others.some((o) => o.trim() !== "")) rejections.push("unmatchedRemainder");
    if (run.score !== 1) rejections.push("normalizationChangedMeaning");
    precision = precisionOf(run.coordinateLevel);
    if (precision === "insufficient") rejections.push("precisionTooLow");
    if (run.coordinateLevel !== run.matchLevel) rejections.push("coordinateCoarserThanMatch");
    if (run.latitude === null || run.longitude === null) rejections.push("noCoordinate");
    else if (!withinJapan(run.latitude, run.longitude)) {
      rejections.push("coordinateInvalid");
    } else coordinate = { latitude: run.latitude, longitude: run.longitude };
    if (!jurisdictionMatches(run, record)) rejections.push("jurisdictionMismatch");
    for (const other of input.secondOpinions ?? []) {
      if (other.latitude !== run.latitude || other.longitude !== run.longitude || other.coordinateLevel !== run.coordinateLevel) {
        rejections.push("geocoderDisagreement");
        break;
      }
    }
  }
  const verdict = rejections.length > 0 ? "rejected" : precision === "residentialDetail" ? "candidate" : "reviewRequired";
  return {
    gateVersion: DERIVED_COORDINATE_GATE_VERSION,
    verdict,
    rejections,
    precision,
    coordinateOrigin: "derivedGeocode",
    publishable: false,
    coordinate: verdict === "rejected" ? null : coordinate,
    dataLicenses: reviewed?.dataLicenses[precision] ?? [],
  };
}

/** The evidence a reviewer approves: the verbatim address, the exact input and the whole geocoder output. */
export function derivedCoordinateEvidenceSha256(input: DerivedCoordinateInput): Promise<string> {
  if (input.geocode === null) throw new Error(`derived coordinate: record ${input.record.recordId} has no geocode run to digest`);
  const g = input.geocode;
  return sha256Hex(JSON.stringify([
    DERIVED_COORDINATE_GATE_VERSION, input.record.recordId, input.record.addressColumn, input.record.officialAddress,
    input.record.inputRule, g.geocoderId, g.geocoderVersion, g.options.target, g.options.fuzzy, g.datasetReleaseId, g.input,
    g.output, g.others, g.score, g.matchLevel, g.coordinateLevel, g.latitude, g.longitude, g.srid, g.lgCode, g.pref, g.city, g.ward,
  ]));
}

/** Two gated places that geocode to the same point are a review event, never a silent merge or a silent pair. */
export function sharedDerivedCoordinates(items: readonly { key: string; evaluation: DerivedCoordinateEvaluation }[]): string[][] {
  const byPoint = new Map<string, string[]>();
  for (const { key, evaluation } of items) {
    if (evaluation.coordinate === null) continue;
    const point = `${evaluation.coordinate.latitude},${evaluation.coordinate.longitude}`;
    byPoint.set(point, [...(byPoint.get(point) ?? []), key]);
  }
  return [...byPoint.values()].filter((keys) => keys.length > 1);
}

export interface DerivedReview {
  evidenceSha256: string;
  decision: "approve" | "reject";
  reviewer: string;
  checks: Record<"officialAddress" | "normalizedAddress" | "returnedLocation" | "precision" | "regionSanity" | "currentListing", boolean>;
  siteEvidence: string | null;
  reviewedAt: string;
}

export type PublicationBlocker =
  | "policyNotApproved" | "gateRejected" | "notReviewed" | "reviewRejected" | "reviewStale" | "reviewIncomplete" | "siteEvidenceMissing";

/**
 * The newest review decides (append-only log, ordered by reviewedAt then position). A review of different evidence —
 * a rerun with another geocoder version or dataset, or a changed address — does not count, so a published derived
 * coordinate never moves because the geocoder changed.
 */
export function derivedPublicationDecision(
  evaluation: DerivedCoordinateEvaluation,
  evidenceSha256: string,
  reviews: readonly DerivedReview[],
  policy: DerivedCoordinatePolicy = DERIVED_COORDINATE_PUBLICATION_POLICY,
): { publish: boolean; blockers: PublicationBlocker[] } {
  const blockers: PublicationBlocker[] = [];
  if (policy.status !== "approved") blockers.push("policyNotApproved");
  if (evaluation.verdict === "rejected") blockers.push("gateRejected");
  const latest = reviews
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.reviewedAt < b.r.reviewedAt ? -1 : a.r.reviewedAt > b.r.reviewedAt ? 1 : a.i - b.i))
    .at(-1)?.r;
  if (latest === undefined) blockers.push("notReviewed");
  else if (latest.evidenceSha256 !== evidenceSha256) blockers.push("reviewStale");
  else if (latest.decision !== "approve") blockers.push("reviewRejected");
  else {
    if (!Object.values(latest.checks).every((v) => v === true) || Object.keys(latest.checks).length !== 6) blockers.push("reviewIncomplete");
    if (evaluation.precision !== "residentialDetail" && !latest.siteEvidence) blockers.push("siteEvidenceMissing");
  }
  return { publish: blockers.length === 0, blockers };
}

export async function recordDerivedGeocode(
  db: Db,
  input: DerivedCoordinateInput,
  evaluation: DerivedCoordinateEvaluation,
  generatedAt: string,
): Promise<{ geocodeId: number; evidenceSha256: string }> {
  const g = input.geocode;
  if (g === null) throw new Error(`derived coordinate: record ${input.record.recordId} has no geocode run to record`);
  if (evaluation.dataLicenses.length === 0) {
    throw new Error(`derived coordinate: geocoder ${g.geocoderId}@${g.geocoderVersion} for record ${input.record.recordId} is not reviewed; its data license is unknown`);
  }
  const evidenceSha256 = await derivedCoordinateEvidenceSha256(input);
  const row = await db.prepare(
    `INSERT INTO derived_coordinate_geocodes (record_id, address_column, official_address, geocoder_input, input_rule, geocoder_id,
       geocoder_version, geocoder_options_json, dataset_release_id, normalized_address, unmatched_json, score, match_level,
       coordinate_level, precision, latitude, longitude, srid, lg_code, data_licenses_json, evidence_sha256, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING geocode_id`,
  ).bind(
    input.record.recordId, input.record.addressColumn, input.record.officialAddress, g.input, input.record.inputRule, g.geocoderId,
    g.geocoderVersion, JSON.stringify(g.options), g.datasetReleaseId, g.output, JSON.stringify(g.others), g.score, g.matchLevel,
    g.coordinateLevel, evaluation.precision, g.latitude, g.longitude, g.srid, g.lgCode, JSON.stringify(evaluation.dataLicenses),
    evidenceSha256, generatedAt,
  ).first<{ geocode_id: number }>();
  if (row === null) throw new Error(`derived coordinate: insert for record ${input.record.recordId} returned no row`);
  return { geocodeId: row.geocode_id, evidenceSha256 };
}

export async function recordDerivedReview(db: Db, geocodeId: number, review: DerivedReview, note: string | null = null): Promise<void> {
  await db.prepare(
    `INSERT INTO derived_coordinate_reviews (geocode_id, evidence_sha256, decision, reviewer, checks_json, site_evidence, note,
       gate_version, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    geocodeId, review.evidenceSha256, review.decision, review.reviewer, JSON.stringify(review.checks), review.siteEvidence, note,
    DERIVED_COORDINATE_GATE_VERSION, review.reviewedAt,
  ).run();
}

/**
 * A publisher later supplying its own coordinate for a spot located by a derived one. The spot keeps its identity;
 * the move is a relocation review item (ADR-0009 policy v1: every coordinate change is reviewed, no distance
 * threshold), and the distance is for the reviewer's display only. Publisher origin is the stronger evidence type,
 * but it never overwrites the derived coordinate through source priority.
 */
export function planPublisherCoordinateReplacement(
  current: { origin: CoordinateOrigin; latitude: number; longitude: number },
  publisher: { latitude: number; longitude: number },
): { action: "none" | "relocationReview"; fromOrigin: CoordinateOrigin; toOrigin: "publisher"; displayDistanceMeters: number } {
  const displayDistanceMeters = haversineMeters(current, publisher);
  const unchanged = current.origin === "publisher" && current.latitude === publisher.latitude && current.longitude === publisher.longitude;
  return { action: unchanged ? "none" : "relocationReview", fromOrigin: current.origin, toOrigin: "publisher", displayDistanceMeters };
}
