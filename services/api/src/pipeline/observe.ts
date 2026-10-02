// Observation: raw source_records -> immutable source_observations, by the release's adapter mapping
// (ADR-0008 decision 2). This and ingest are the only steps that read a source's raw schema; the
// resolver reads observations. Observations are derived, so deriving them twice writes nothing new.

import { type Db } from "../db.ts";
import { observeSourceRecord, type SourceAdapter, type SourceObservation } from "./source-adapter.ts";

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
  opening_hours_raw: string | null;
  opening_hours_json: string | null;
  opening_hours_status: "none" | "parsed" | "unparsed";
  lifecycle_claim: SourceObservation["lifecycle"];
  field_provenance_json: string;
  /** Absent on a schema before 0023. */
  claims_json?: string | null;
}

/** The ADR-0012 members of an observation, stored together; null when the record states none of them. */
function claimsOf(o: SourceObservation): string | null {
  if (o.classification === undefined && o.existenceEvidence === undefined && o.communityConfirmations === undefined
    && o.locationAnchorId === undefined) return null;
  return JSON.stringify({
    classification: o.classification ?? null,
    existenceEvidence: o.existenceEvidence ?? null,
    communityConfirmations: o.communityConfirmations ?? null,
    // ADR-0017; the key is written only when present, so every pre-0030 claims_json stays byte-identical.
    ...(o.locationAnchorId === undefined ? {} : { locationAnchorId: o.locationAnchorId }),
  });
}

function columnsOf(o: SourceObservation) {
  return [
    o.name, o.latitude, o.longitude, o.supportsPaper, o.supportsHeated, o.openingHours.raw,
    o.openingHours.parsed === null ? null : JSON.stringify(o.openingHours.parsed), o.openingHours.status,
    o.lifecycle, JSON.stringify(o.provenance), claimsOf(o),
  ];
}

function fromRow(row: ObservationRow): SourceObservation {
  return {
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    supportsPaper: row.supports_paper,
    supportsHeated: row.supports_heated,
    openingHours: row.opening_hours_status === "none"
      ? { status: "none", raw: null, parsed: null }
      : row.opening_hours_status === "parsed"
        ? { status: "parsed", raw: row.opening_hours_raw!, parsed: JSON.parse(row.opening_hours_json!) }
        : { status: "unparsed", raw: row.opening_hours_raw!, parsed: null },
    lifecycle: row.lifecycle_claim,
    provenance: JSON.parse(row.field_provenance_json),
    ...claimsFromJson(row.claims_json),
  };
}

function claimsFromJson(json: string | null | undefined): Pick<SourceObservation, "classification" | "existenceEvidence" | "communityConfirmations" | "locationAnchorId"> {
  if (json === null || json === undefined) return {};
  const c = JSON.parse(json);
  return {
    ...(c.classification === null ? {} : { classification: c.classification }),
    ...(c.existenceEvidence === null ? {} : { existenceEvidence: c.existenceEvidence }),
    ...(c.communityConfirmations === null ? {} : { communityConfirmations: c.communityConfirmations }),
    ...(typeof c.locationAnchorId === "string" ? { locationAnchorId: c.locationAnchorId } : {}),
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
    const values: string[] = JSON.parse(record.raw_values_json);
    const stored = existingByRecord.get(record.record_id);
    if (adapter.includesRecord && !adapter.includesRecord(values)) {
      if (stored) throw new Error(`observe: record ${record.record_id} scope changed under ${adapter.mappingVersion}; a mapping change needs a new mappingVersion`);
      continue;
    }
    // A generation is derived in one atomic batch. A newly included row in an existing
    // generation is a scope change, just as excluding a stored row is.
    if (!stored && existing.length > 0) {
      throw new Error(`observe: record ${record.record_id} scope changed under ${adapter.mappingVersion}; a mapping change needs a new mappingVersion`);
    }
    const derived = observeSourceRecord(adapter, values);
    if (stored) {
      if (JSON.stringify(columnsOf(stored)) !== JSON.stringify(columnsOf(derived))) {
        throw new Error(
          `observe: record ${record.record_id} re-derives differently under ${adapter.mappingVersion}; ` +
            "a mapping change needs a new mappingVersion",
        );
      }
      continue;
    }
    // claims_json (0023) is named only when the record states something for it, so an official record's insert
    // is exactly the pre-0023 statement.
    const columns = columnsOf(derived);
    const claims = columns.pop();
    statements.push(db.prepare(
      `INSERT INTO source_observations (record_id, release_id, source_id, mapping_version, name, latitude, longitude,
         supports_paper, supports_heated, opening_hours_raw, opening_hours_json, opening_hours_status,
         lifecycle_claim, field_provenance_json${claims === null ? "" : ", claims_json"})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${claims === null ? "" : ", ?"})`,
    ).bind(record.record_id, releaseId, release.source_id, adapter.mappingVersion, ...columns, ...(claims === null ? [] : [claims])));
  }
  if (statements.length > 0) await db.batch(statements);
  return statements.length > 0 ? readObservations(db, adapter, releaseId) : existing;
}

/**
 * Re-derives one record's observation from its raw values under `adapter.mappingVersion` and requires the
 * stored row of that version to exist and be identical. Returns the stored row's id with the re-derived
 * observation. For a step that mutates canonical rows from a cited observation (a relocation application):
 * a stored row alone does not show that the adapter's current mapping still derives it. Writes nothing.
 */
export async function rederiveObservation(db: Db, adapter: SourceAdapter, recordId: number): Promise<StoredObservation & { releaseId: number }> {
  const record = await db.prepare(
    `SELECT r.release_id, r.raw_values_json, rel.source_id, rel.parser_version
     FROM source_records r JOIN source_releases rel ON rel.release_id = r.release_id WHERE r.record_id = ?`,
  ).bind(recordId).first<{ release_id: number; raw_values_json: string; source_id: string; parser_version: string }>();
  if (!record) throw new Error(`observe: record ${recordId} does not exist`);
  if (record.source_id !== adapter.registry.sourceId || record.parser_version !== adapter.parserVersion) {
    throw new Error(`observe: record ${recordId} is ${record.source_id} parsed by ${record.parser_version}, not ${adapter.registry.sourceId} parsed by ${adapter.parserVersion}`);
  }
  const row = await db.prepare("SELECT * FROM source_observations WHERE record_id = ? AND mapping_version = ?")
    .bind(recordId, adapter.mappingVersion).first<ObservationRow>();
  if (!row) throw new Error(`observe: record ${recordId} has no ${adapter.mappingVersion} observation`);
  const values: string[] = JSON.parse(record.raw_values_json);
  if (adapter.includesRecord && !adapter.includesRecord(values)) {
    throw new Error(`observe: record ${recordId} scope changed under ${adapter.mappingVersion}; a mapping change needs a new mappingVersion`);
  }
  const derived = observeSourceRecord(adapter, values);
  if (JSON.stringify(columnsOf(fromRow(row))) !== JSON.stringify(columnsOf(derived))) {
    throw new Error(`observe: record ${recordId} re-derives differently from its stored ${adapter.mappingVersion} observation ${row.observation_id}`);
  }
  return { observationId: row.observation_id, recordId, releaseId: record.release_id, observation: derived };
}

async function readObservations(db: Db, adapter: SourceAdapter, releaseId: number): Promise<StoredObservation[]> {
  const { results } = await db.prepare(
    `SELECT o.* FROM source_observations o JOIN source_records r ON r.record_id = o.record_id
     WHERE o.release_id = ? AND o.mapping_version = ? ORDER BY r.ordinal`,
  ).bind(releaseId, adapter.mappingVersion).all<ObservationRow>();
  return results.map((row) => ({ observationId: row.observation_id, recordId: row.record_id, observation: fromRow(row) }));
}
