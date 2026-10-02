// ADR-0017 research replay rules (approximate-location-replay.v1). Pure functions over committed review records. The
// question per reviewed target: now that a missing exact smoking-point coordinate alone no longer rejects an evidenced
// place, which targets does ADR-0017 rescue, and what blocks the rest? Nothing here fetches, approves or publishes,
// and nothing is rescued automatically: a target is A only when every other gate is already met.
//
//   A rescuedByAreaApproximate  existence explicit, located inside a named area/host, a reusable anchor exists under
//                               anchor policy v1, rights reviewed, no closure/prohibition: publishable as areaApproximate.
//   B existenceInsufficient     the source does not state that a smoking place exists (a host, a catalog, a policy).
//   C rightsBlocked             existence is explicit, but the exact resource's reuse terms are not reviewed.
//   D noReusableAnchor          existence and rights would allow it, but no reviewed reusable area anchor exists.
//   E currentOperation          explicit closure/suspension evidence for the place.
//   F prohibitionOrConflict     a ban, or publications that conflict and need reconciliation.
//   G geocodingNeeded           located only by street address: ADR-0011 (Proposed), not an area anchor.
//   H other                     review pending, raw unreadable, or already a published source.
//
// Precedence is F, B, H(pending/access), C, E, G, D, A: the strongest reason a target cannot publish is its category.
// `adr0017RemovesLocationBlocker` is recorded separately: whether the exact-point blocker is answered by ADR-0017 once
// the target's other gates (usually rights) are cleared.

export const APPROXIMATE_REPLAY_VERSION = "approximate-location-replay.v1";

export type ReplayCategory =
  | "A-rescuedByAreaApproximate" | "B-existenceInsufficient" | "C-rightsBlocked" | "D-noReusableAnchor"
  | "E-currentOperation" | "F-prohibitionOrConflict" | "G-geocodingNeeded" | "H-other";

/** How a reviewed target locates its smoking places, as recorded in the review text (hand-annotated, see the script). */
export type LocationForm =
  | "areaOrHost"      // inside a named park, station, airport terminal, facility or building
  | "addressOnly"     // street addresses / relative descriptions only
  | "exactPoint"      // the publisher supplies the smoking place's own point: ADR-0017 is not what blocks it
  | "unestablished"   // explicit places, but the review could not tell how they are located
  | "none";           // no smoking place located at all

export interface ReplayRecord {
  targetId: string;
  jurisdiction: string;
  prefecture: string | null;
  blockerCodes: string[];
  /** Whether the review established explicit smoking-place existence (official reverse review field, or annotation). */
  explicitExistence: boolean;
  location: LocationForm;
  /** A reviewed, reusable anchor for the area under anchor policy v1 (the existence source's own point for the area). */
  reusableAnchor: boolean;
  alreadyPublished: boolean;
  /** Texts the precedence rules read: smoking evidence, current operation, reason. */
  text: string;
}

export const RIGHTS = ["exactResourceRights", "scopedExactLicense", "exactReuseLicenseNotEstablished", "reuseForbidden", "licenseUnknown",
  "exactTermsUnknown", "redistributionBlocked", "reviewedPublicationGate"];
const PENDING = ["substantiveReviewPending", "substantiveSourceReviewPending", "resourceNotInspected", "rawUnavailable", "accessBlocked",
  "accessBlockedHostStopped"];
const CONFLICT = ["closureOrAvailabilityRequiresReconciliation", "publisherJurisdictionMismatch"];
const EXISTENCE = ["explicitSmokingPlaceEvidence", "explicitSmokingEvidence", "noSmokingEvidence", "noSmokingPoint",
  "specificExistenceNotEstablished", "noPermittedSmokingPlaceEvidence", "exactFacilityInventoryNotEstablished"];

const has = (codes: readonly string[], set: readonly string[]) => codes.some((c) => set.includes(c));

export function classifyApproximate(r: ReplayRecord): { category: ReplayCategory; adr0017RemovesLocationBlocker: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // A ban on the whole facility/network, not a street-smoking prohibition district (which says nothing either way
  // about permitted places and stays an existence question).
  const ban = !r.explicitExistence && (r.blockerCodes.includes("noPermittedSmokingPlaceEvidence")
    || /all-station ban|full-facility ban|prohibits smoking in|smoke[- ]free (?:stations|premises)/i.test(r.text));
  if (ban) reasons.push("prohibition");
  if (has(r.blockerCodes, CONFLICT)) reasons.push("conflictNeedsReconciliation");
  if (!r.explicitExistence) reasons.push("existenceNotExplicit");
  if (has(r.blockerCodes, PENDING)) reasons.push("reviewPendingOrAccess");
  if (has(r.blockerCodes, RIGHTS)) reasons.push("rightsUnreviewed");
  if (/\bclosed\b|closure|suspended|abolished|休止|閉鎖|廃止/i.test(r.text) && r.explicitExistence) reasons.push("closureEvidencePresent");
  if (r.location === "addressOnly") reasons.push("addressOnly");
  if (r.location === "areaOrHost" && !r.reusableAnchor) reasons.push("noReusableAnchor");

  // ADR-0017 answers the location blocker only for an explicit place inside a named area/host.
  const adr0017RemovesLocationBlocker = r.explicitExistence && r.location === "areaOrHost";
  let category: ReplayCategory;
  if (r.alreadyPublished) category = "H-other";
  else if (reasons.includes("prohibition") || reasons.includes("conflictNeedsReconciliation")) category = "F-prohibitionOrConflict";
  else if (reasons.includes("existenceNotExplicit") || has(r.blockerCodes, EXISTENCE) && !r.explicitExistence) category = "B-existenceInsufficient";
  else if (reasons.includes("reviewPendingOrAccess")) category = "H-other";
  else if (reasons.includes("rightsUnreviewed")) category = "C-rightsBlocked";
  // Closure wording blocks only where it is about the place itself; a review that already excluded the closed site
  // from existence leaves the rest. Recorded as a reason either way.
  else if (reasons.includes("closureEvidencePresent") && r.location === "none") category = "E-currentOperation";
  else if (r.location === "addressOnly") category = "G-geocodingNeeded";
  else if (r.location === "areaOrHost" && !r.reusableAnchor) category = "D-noReusableAnchor";
  else if (adr0017RemovesLocationBlocker) category = "A-rescuedByAreaApproximate";
  else category = "H-other";
  return { category, adr0017RemovesLocationBlocker, reasons };
}
