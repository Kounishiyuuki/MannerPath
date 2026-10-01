// Report terms and consent (Issue #124, ADR-0007 amendment 2026-09-30, migration 0021).
//
// A report records the terms version its submitter explicitly accepted (`acceptedTermsVersion` in the report
// payload, so in a v2 submission it is inside the bytes App Attest signs). The reviewed list below is the only
// place a terms version and its publication rights are decided; the `report_terms_versions` table mirrors it the
// way `sources` mirrors REVIEWED_SOURCES, and the publication gates read that table.
//
// The current document is a DRAFT. Consent to it is recorded, but it grants no publication rights: `pending`
// forever. Approval never flips the draft: the draft told submitters nothing publishes on it, so approval is a NEW
// version added by the maintainer decision (./community-publication.ts), and only reports consented to that exact
// version may publish. Nothing is ever applied retroactively: a report stored without a version never gains one.

import { type Db, type DbStatement } from "../db.ts";
import { COMMUNITY_PUBLICATION, decisionTerms } from "./community-publication.ts";

export type TermsPublicationRights = "pending" | "granted" | "revoked";

export interface ReviewedTerms {
  version: string;
  /** Repository path of the exact document shown to the submitter. */
  documentPath: string;
  /** SHA-256 of that document's bytes; test/report-terms.test.ts pins it. */
  documentSha256: string;
  publicationRights: TermsPublicationRights;
}

/** The shape a terms version may take on the wire and in the database (0021). */
export const TERMS_VERSION = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export const REPORT_TERMS: readonly ReviewedTerms[] = [
  {
    version: "report-terms.2026-09-30.draft",
    documentPath: "docs/legal/REPORT_TERMS_DRAFT.md",
    documentSha256: "7b6fc8cbe07cb53d539035c78aed9259072852562f54a9224b2500fbda33bce0",
    // DRAFT — requires legal/maintainer approval before production (Issue #124).
    publicationRights: "pending",
  },
  // The approved final version, if any, comes only from the maintainer decision (./community-publication.ts). It is
  // a new version: reports consented to the draft above never gain rights from it.
  ...decisionTerms(COMMUNITY_PUBLICATION),
];

/** The version a client must show and a new report must accept; /v1/config publishes it. */
export const CURRENT_REPORT_TERMS: ReviewedTerms = REPORT_TERMS[REPORT_TERMS.length - 1];

const byVersion = new Map(REPORT_TERMS.map((t) => [t.version, t]));

export function reviewedTerms(version: string): ReviewedTerms {
  const terms = byVersion.get(version);
  if (!terms) throw new Error(`terms: ${version} is not a reviewed terms version`);
  return terms;
}

/**
 * REPORTS_DB (ADR-0014): records the document a submitter consented to, if it is not recorded yet. Rights are never
 * written to the report store; they are the canonical mirror's (ensureTermsStatement, DATA_DB).
 */
export function ensureConsentDocumentStatement(db: Db, terms: ReviewedTerms, now: string): DbStatement {
  return db.prepare(
    `INSERT INTO report_terms_documents (terms_version, document_path, document_sha256, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT (terms_version) DO NOTHING`,
  ).bind(terms.version, terms.documentPath, terms.documentSha256, now);
}

/** DATA_DB: creates the mirror row of a reviewed version if it is missing; an existing row is never touched here. */
export function ensureTermsStatement(db: Db, terms: ReviewedTerms, now: string): DbStatement {
  return db.prepare(
    `INSERT INTO report_terms_versions (terms_version, document_path, document_sha256, publication_rights, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (terms_version) DO NOTHING`,
  ).bind(terms.version, terms.documentPath, terms.documentSha256, terms.publicationRights, now, now);
}

/**
 * Re-applies the reviewed publication rights of every version to its mirror row (the explicit upgrade path,
 * `npm run local:registry`). A revoked or still-pending version empties the tiles of what depends on it at the
 * next publish, exactly as a blocked source does.
 */
export async function applyReportTermsRegistry(db: Db, now: string): Promise<{ version: string; publicationRights: TermsPublicationRights }[]> {
  const statements: DbStatement[] = [];
  for (const terms of REPORT_TERMS) {
    statements.push(ensureTermsStatement(db, terms, now));
    statements.push(db.prepare(
      "UPDATE report_terms_versions SET publication_rights = ?, updated_at = ? WHERE terms_version = ? AND publication_rights <> ?",
    ).bind(terms.publicationRights, now, terms.version, terms.publicationRights));
  }
  await db.batch(statements);
  return REPORT_TERMS.map((t) => ({ version: t.version, publicationRights: t.publicationRights }));
}
