// Observation: raw source_records -> immutable source_observations, by the release's adapter mapping
// (ADR-0008 decision 2). This and ingest are the only steps that read a source's raw schema; the
// resolver reads observations. Observations are derived, so deriving them twice writes nothing new.

import { type Db } from "../db.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export interface StoredObservation {
  observationId: number;
  recordId: number;
  observation: SourceObservation;
}

interface ObservationRow {
  observation_id: number;
  record_id: number;
  name: string | null;
  latitude: number;
  longitude: number;
  supports_paper: SourceObservation["supportsPaper"];
  supports_heated: SourceObservation["supportsHeated"];
  opening_hours_raw: string;
  opening_hours_json: string | null;
  opening_hours_status: "parsed" | "unparsed";
  lifecycle_claim: SourceObservation["lifecycle"];
  field_provenance_json: string;
}

function columnsOf(o: SourceObservation) {
  return [
    o.name, o.latitude, o.longitude, o.supportsPaper, o.supportsHeated, o.openingHours.raw,
    o.openingHours.parsed === null ? null : JSON.stringify(o.openingHours.parsed), o.openingHours.status,
    o.lifecycle, JSON.stringify(o.provenance),
  ];
}

function fromRow(row: ObservationRow): SourceObservation {
  return {
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    supportsPaper: row.supports_paper,
    supportsHeated: row.supports_heated,
    openingHours: row.opening_hours_status === "parsed"
      ? { status: "parsed", raw: row.opening_hours_raw, parsed: JSON.parse(row.opening_hours_json!) }
      : { status: "unparsed", raw: row.opening_hours_raw, parsed: null },
    lifecycle: row.lifecycle_claim,
    provenance: JSON.parse(row.field_provenance_json),
  };
}

/**
 * Derives the observations of `releaseId` under `adapter.mappingVersion` and returns them in record
 * order. Fails closed before any write unless the release is the adapter's source and was parsed by
 * the adapter's parser. Rows that already exist for (record, mapping version) are not written again;
 * they are re-derived and must be identical, so a mapping change without a version change is refused.
 */
export async function observeRelease(db: Db, adapter: SourceAdapter, releaseId: number): Promise<StoredObservation[]> {
  const release = await db.prepare(
    "SELECT source_id, parser_version FROM source_releases WHERE release_id = ?",
  ).bind(releaseId).first<{ source_id: string; parser_version: string }>();
  if (!release) throw new Error(`observe: release ${releaseId} does not exist`);
  if (release.source_id !== adapter.registry.sourceId) {
    throw new Error(`observe: release ${releaseId} belongs to ${release.source_id}, not to adapter source ${adapter.registry.sourceId}`);
  }
  if (release.parser_version !== adapter.parserVersion) {
    throw new Error(`observe: release ${releaseId} was parsed by ${release.parser_version}, not ${adapter.parserVersion}`);
  }

  const { results: records } = await db.prepare(
    "SELECT record_id, raw_values_json FROM source_records WHERE release_id = ? ORDER BY ordinal",
  ).bind(releaseId).all<{ record_id: number; raw_values_json: string }>();
  const existing = await readObservations(db, adapter, releaseId);
  const existingByRecord = new Map(existing.map((o) => [o.recordId, o.observation]));

  const statements = [];
  for (const record of records) {
    const derived = adapter.observe(JSON.parse(record.raw_values_json));
    const stored = existingByRecord.get(record.record_id);
    if (stored) {
      if (JSON.stringify(columnsOf(stored)) !== JSON.stringify(columnsOf(derived))) {
        throw new Error(
          `observe: record ${record.record_id} re-derives differently under ${adapter.mappingVersion}; ` +
            "a mapping change needs a new mappingVersion",
        );
      }
      continue;
    }
    statements.push(db.prepare(
      `INSERT INTO source_observations (record_id, release_id, source_id, mapping_version, name, latitude, longitude,
         supports_paper, supports_heated, opening_hours_raw, opening_hours_json, opening_hours_status,
         lifecycle_claim, field_provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(record.record_id, releaseId, release.source_id, adapter.mappingVersion, ...columnsOf(derived)));
  }
  if (statements.length > 0) await db.batch(statements);
  return statements.length > 0 ? readObservations(db, adapter, releaseId) : existing;
}

async function readObservations(db: Db, adapter: SourceAdapter, releaseId: number): Promise<StoredObservation[]> {
  const { results } = await db.prepare(
    `SELECT o.* FROM source_observations o JOIN source_records r ON r.record_id = o.record_id
     WHERE o.release_id = ? AND o.mapping_version = ? ORDER BY r.ordinal`,
  ).bind(releaseId, adapter.mappingVersion).all<ObservationRow>();
  return results.map((row) => ({ observationId: row.observation_id, recordId: row.record_id, observation: fromRow(row) }));
}
