// The community publication decision (Issue #124, Issue #150, docs/legal/COMMUNITY_PUBLICATION_DECISION.md).
//
// This constant is the ONE place a maintainer applies their decision. The report terms registry (./terms.ts) and the
// community source registry entry (../pipeline/community-adapter.ts) are both derived from it, so activation is not
// "edit several files by hand": it is this constant, the final terms document it names, and the app's bundled copy
// of that document — one small PR that test/community-activation.test.ts checks for consistency.
//
//   pending   — Issue #124 open. No community terms version exists beyond the draft; the source stays blocked.
//   approved  — a maintainer approved `termsVersion` (a NEW version, never the draft). Reports consented to exactly
//               that version may publish; the source is approved with the reviewed license and attribution.
//   suspended — rollback (docs/OPERATIONS.md, community rollback). The version's rights become `revoked` and the
//               source `blocked`: community spots leave the tiles at the next publish, nothing is deleted, and
//               returning to `approved` restores them. Consent already given is untouched.
//
// Code never moves this constant. scripts/community-activation.ts only applies what it says, and refuses unless it
// says `approved` for exactly the version on its command line.

import type { ReviewedTerms } from "./terms.ts";

/** The attribution every community spot carries in tiles, spot detail, iPhone and Watch. No person, no ID. */
export const COMMUNITY_ATTRIBUTION_CANDIDATE = "MannerPath 利用者報告（審査済み）";

/** The candidate document a maintainer reviews; activation copies it, filled in, to the versioned path. */
export const COMMUNITY_TERMS_CANDIDATE_PATH = "docs/legal/REPORT_TERMS_CANDIDATE.md";

/** Marks text a maintainer must supply. An approved document may not contain it (checked by the activation test). */
export const MAINTAINER_INPUT_MARKER = "MAINTAINER-INPUT";

export interface ApprovedCommunityTerms {
  /** A new version, e.g. `report-terms.2026-11-01`. Never one ending in `.draft`. */
  termsVersion: string;
  /** Repository path of the exact approved document, e.g. `docs/legal/report-terms/report-terms.2026-11-01.md`. */
  documentPath: string;
  /** SHA-256 of that document's bytes. */
  documentSha256: string;
  /** Public URL where the approved terms are published (the source's license URL). */
  termsUrl: string;
  /** Who approved, in the maintainer's own words (a GitHub handle), and when (YYYY-MM-DD). */
  approvedBy: string;
  approvedOn: string;
}

export type CommunityPublicationDecision =
  | { state: "pending" }
  | ({ state: "approved" } & ApprovedCommunityTerms)
  | ({ state: "suspended"; suspendedOn: string } & ApprovedCommunityTerms);

/**
 * MAINTAINER DECISION (Issue #124). `pending` until a maintainer approves in a reviewed PR; see
 * docs/legal/COMMUNITY_PUBLICATION_DECISION.md for exactly what changes here.
 */
export const COMMUNITY_PUBLICATION: CommunityPublicationDecision = { state: "pending" };

/** The license name the community source carries once a version is approved: the terms themselves. */
export function communityLicenseName(termsVersion: string): string {
  return `MannerPath 利用者報告規約 (${termsVersion})`;
}

/** The reviewed terms entry a decision adds after the draft: none while pending. */
export function decisionTerms(decision: CommunityPublicationDecision): ReviewedTerms[] {
  if (decision.state === "pending") return [];
  return [{
    version: decision.termsVersion,
    documentPath: decision.documentPath,
    documentSha256: decision.documentSha256,
    publicationRights: decision.state === "approved" ? "granted" : "revoked",
  }];
}

/** The community source's reviewed license fields and status under a decision. */
export function decisionSourceFields(decision: CommunityPublicationDecision): {
  licenseName: string | null; licenseUrl: string | null; attributionText: string | null; publicationStatus: "approved" | "blocked";
} {
  if (decision.state === "pending") return { licenseName: null, licenseUrl: null, attributionText: null, publicationStatus: "blocked" };
  return {
    licenseName: communityLicenseName(decision.termsVersion),
    licenseUrl: decision.termsUrl,
    attributionText: COMMUNITY_ATTRIBUTION_CANDIDATE,
    publicationStatus: decision.state === "approved" ? "approved" : "blocked",
  };
}

/**
 * Every reason a decision cannot be applied, given the bytes of the document it names (null: missing). Empty means
 * consistent. `pending` is always consistent: it applies nothing.
 */
export function decisionProblems(decision: CommunityPublicationDecision, document: Uint8Array | null, sha256: (b: Uint8Array) => string): string[] {
  if (decision.state === "pending") return [];
  const problems: string[] = [];
  if (!/^report-terms\.[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z0-9-]+)?$/.test(decision.termsVersion)) problems.push(`termsVersion ${decision.termsVersion} is not report-terms.YYYY-MM-DD[.suffix]`);
  if (/\.(draft|candidate)$/.test(decision.termsVersion)) problems.push("a draft or candidate version can never grant publication rights");
  if (!/^docs\/legal\/report-terms\/[a-z0-9.-]+\.md$/.test(decision.documentPath)) problems.push("documentPath must be docs/legal/report-terms/<version>.md");
  if (!decision.documentPath.endsWith(`/${decision.termsVersion}.md`)) problems.push("documentPath must be named after termsVersion");
  if (!/^https:\/\/\S+$/.test(decision.termsUrl)) problems.push("termsUrl must be a public https URL");
  if (decision.approvedBy.trim() === "") problems.push("approvedBy is empty");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(decision.approvedOn)) problems.push("approvedOn must be YYYY-MM-DD");
  if (document === null) {
    problems.push(`${decision.documentPath} does not exist`);
  } else {
    if (sha256(document) !== decision.documentSha256) problems.push(`${decision.documentPath} does not match documentSha256`);
    const text = new TextDecoder().decode(document);
    if (text.includes(MAINTAINER_INPUT_MARKER)) problems.push(`${decision.documentPath} still contains ${MAINTAINER_INPUT_MARKER} placeholders`);
    if (/DRAFT|CANDIDATE/.test(text)) problems.push(`${decision.documentPath} still says DRAFT or CANDIDATE`);
    if (!text.includes(decision.termsVersion)) problems.push(`${decision.documentPath} does not name its own version`);
  }
  return problems;
}

export type ActivationPlan =
  | { ok: false; problems: string[] }
  | { ok: true; terms: ReviewedTerms; source: ReturnType<typeof decisionSourceFields> };

/**
 * What `npm run community:activate -- --terms-version <v>` may apply. It refuses unless the repository-controlled
 * decision already says `approved` for exactly that version and is internally consistent: the command line can name
 * a version, never approve one.
 */
export function planActivation(
  decision: CommunityPublicationDecision, requestedVersion: string | undefined,
  document: Uint8Array | null, sha256: (b: Uint8Array) => string,
): ActivationPlan {
  if (requestedVersion === undefined) return { ok: false, problems: ["--terms-version <version> is required"] };
  if (decision.state !== "approved") {
    return { ok: false, problems: [`COMMUNITY_PUBLICATION is ${decision.state}: only a reviewed maintainer change to src/reports/community-publication.ts approves community publication (Issue #124)`] };
  }
  if (decision.termsVersion !== requestedVersion) {
    return { ok: false, problems: [`--terms-version ${requestedVersion} is not the approved version ${decision.termsVersion}`] };
  }
  const problems = decisionProblems(decision, document, sha256);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, terms: decisionTerms(decision)[0], source: decisionSourceFields(decision) };
}
