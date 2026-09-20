// Storing a report (ADR-0007). A report is an append-only proposal: this module writes the event
// and its pending moderation row in one batch, and touches no canonical or published table.

import { type Db, isoSeconds, sha256Hex } from "../db.ts";
import type { AttestationStatus } from "./attestation.ts";
import { REPORT_SCHEMA_VERSION, type ReportAcceptedV1, type ReportRequestV1, quantizeCoordinate } from "./dto.ts";
import { newReportId } from "./report-id.ts";

/** Personal content is minimized this long after arrival, whatever the moderation state. */
export const REPORT_MINIMIZE_AFTER_DAYS = 90;

export function minimizeAfter(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + REPORT_MINIMIZE_AFTER_DAYS * 86_400_000);
}

/**
 * The abuse key. The raw installId never leaves this function: it is not stored, returned or
 * logged. The pepper comes from a binding and is absent locally, which weakens the hash against a
 * guessed-installId lookup but changes nothing else (ADR-0007 §5).
 */
export function submitterHash(installId: string, pepper: string | undefined): Promise<string> {
  return sha256Hex(`${pepper ?? ""}\n${installId.toLowerCase()}`);
}

export interface CreateReportOptions {
  now: Date;
  attestationStatus: AttestationStatus;
  submitterHash: string;
  newReportId?: () => string;
}

export async function createReport(
  db: Db,
  request: ReportRequestV1,
  opts: CreateReportOptions,
): Promise<ReportAcceptedV1> {
  const reportId = (opts.newReportId ?? newReportId)();
  const receivedAt = isoSeconds(opts.now);
  const location = request.proposedLocation;

  await db.batch([
    db.prepare(
      `INSERT INTO reports (
         report_id, schema_version, report_type, subject_spot_id,
         proposed_latitude, proposed_longitude, observed_on, note,
         submitter_hash, attestation_status, received_at, minimize_after, redacted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      reportId,
      REPORT_SCHEMA_VERSION,
      request.type,
      request.spotId ?? null,
      location === undefined ? null : quantizeCoordinate(location.latitude),
      location === undefined ? null : quantizeCoordinate(location.longitude),
      request.observedOn ?? null,
      request.note ?? null,
      opts.submitterHash,
      opts.attestationStatus,
      receivedAt,
      isoSeconds(minimizeAfter(opts.now)),
    ),
    db.prepare(
      `INSERT INTO report_moderation (report_id, state, reconciliation_state, updated_at)
       VALUES (?, 'pending', 'notQueued', ?)`,
    ).bind(reportId, receivedAt),
  ]);

  return { schemaVersion: REPORT_SCHEMA_VERSION, reportId, state: "pending", receivedAt };
}
