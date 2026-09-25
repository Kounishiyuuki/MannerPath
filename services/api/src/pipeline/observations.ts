// ADR-0008 decision 2: immutable normalized observations between raw source records and the generic
// resolver. Raw source_records remain the evidence; these rows are deterministic, re-derivable
// adapter output keyed by (record_id, mapping_version).

import { type Db } from "../db.ts";
import type { NormalizedSourceObservation, SourceAdapter } from "./source-adapter.ts";

interface ReleaseRow {
  source_id: string;
  parser_version: string;
  content_sha256: string;
  observed_on: string | null;
  source_url: string;
}

interface RawRecordRow {
  record_id: number;
  release_id: number;
  raw_values_json: string;
}

interface ObservationDbRow {
  observation_id: number;
  record_id: number;
  release_id: number;
  source_id: string;
  mapping_version: string;
  name: string | null;
  latitude: number;
  longitude: number;
  supports_paper: "yes" | "no" | "unknown";
  supports_heated: "yes" | "no" | "unknown";
  opening_hours_raw: string;
  opening_hours_json: string | null;
  opening_hours_status: "parsed" | "unparsed";
  lifecycle: "active" | "temporarilyClosed" | "removed";
  publication_hold: string | null;
  provenance_json: string;
  attenuations_json: string;
}

type ObservationComparable = Omit<ObservationDbRow, "observation_id">;

export interface StoredSourceObservation extends NormalizedSourceObservation {
  observationId: number;
  recordId: number;
  releaseId: number;
  sourceId: string;
  mappingVersion: string;
}

function encodedObservation(
  mapped: NormalizedSourceObservation,
  record: RawRecordRow,
  sourceId: string,
  mappingVersion: string,
): ObservationComparable {
  let openingHoursJson: string | null = null;
  if (mapped.openingHours.status === "parsed") {
    const encoded = JSON.stringify(mapped.openingHours.parsed);
    if (encoded === undefined) throw new Error("observations: parsed opening hours must be JSON-serializable");
    openingHoursJson = encoded;
  }
  return {
    record_id: record.record_id,
    release_id: record.release_id,
    source_id: sourceId,
    mapping_version: mappingVersion,
    name: mapped.name,
    latitude: mapped.latitude,
    longitude: mapped.longitude,
    supports_paper: mapped.supportsPaper,
    supports_heated: mapped.supportsHeated,
    opening_hours_raw: mapped.openingHours.raw,
    opening_hours_json: openingHoursJson,
    opening_hours_status: mapped.openingHours.status,
    lifecycle: mapped.lifecycle,
    publication_hold: mapped.publicationHold,
    provenance_json: JSON.stringify(mapped.provenance.map((p) => ({
      field: p.field,
      columns: [...p.columns],
      rule: p.rule,
    }))),
    attenuations_json: JSON.stringify(mapped.attenuations.map((a) => ({
      field: a.field,
      effect: a.effect,
    }))),
  };
}

function comparable(row: ObservationDbRow): ObservationComparable {
  const { observation_id: _ignored, ...rest } = row;
  return rest;
}

function decode(row: ObservationDbRow): StoredSourceObservation {
  return {
    observationId: row.observation_id,
    recordId: row.record_id,
    releaseId: row.release_id,
    sourceId: row.source_id,
    mappingVersion: row.mapping_version,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    supportsPaper: row.supports_paper,
    supportsHeated: row.supports_heated,
    openingHours: row.opening_hours_status === "parsed"
      ? { status: "parsed", raw: row.opening_hours_raw, parsed: JSON.parse(row.opening_hours_json as string) }
      : { status: "unparsed", raw: row.opening_hours_raw, parsed: null },
    lifecycle: row.lifecycle,
    publicationHold: row.publication_hold,
    provenance: JSON.parse(row.provenance_json) as { field: string; columns: string[]; rule: string }[],
    attenuations: JSON.parse(row.attenuations_json) as { field: string; effect: string }[],
  };
}

export async function ensureReleaseObservations(
  db: Db,
  adapter: SourceAdapter,
  releaseId: number,
): Promise<StoredSourceObservation[]> {
  if (adapter.mappingVersion.trim() === "") throw new Error("observations: adapter mappingVersion must not be empty");

  const release = await db.prepare(
    "SELECT source_id, parser_version, content_sha256, observed_on, source_url FROM source_releases WHERE release_id = ?",
  ).bind(releaseId).first<ReleaseRow>();
  if (!release) throw new Error("observations: release " + releaseId + " does not exist");
  if (release.source_id !== adapter.registry.sourceId) {
    throw new Error("observations: release " + releaseId + " belongs to " + release.source_id +
      ", not to adapter source " + adapter.registry.sourceId);
  }
  if (release.parser_version !== adapter.parserVersion) {
    throw new Error("observations: release " + releaseId + " was parsed by " + release.parser_version +
      ", not " + adapter.parserVersion);
  }

  const { results: records } = await db.prepare(
    "SELECT record_id, release_id, raw_values_json FROM source_records WHERE release_id = ? ORDER BY ordinal",
  ).bind(releaseId).all<RawRecordRow>();
  if (records.length === 0) throw new Error("observations: release " + releaseId + " has no records");

  const rawValues = records.map((record) => JSON.parse(record.raw_values_json) as string[]);
  adapter.assertResolvable(
    { contentSha256: release.content_sha256, observedOn: release.observed_on, sourceUrl: release.source_url },
    rawValues,
  );

  const desired = records.map((record, i) =>
    encodedObservation(adapter.mapRecord(rawValues[i]), record, release.source_id, adapter.mappingVersion));

  const inserts = [];
  for (const row of desired) {
    const existing = await db.prepare(
      "SELECT * FROM source_observations WHERE record_id = ? AND mapping_version = ?",
    ).bind(row.record_id, row.mapping_version).first<ObservationDbRow>();
    if (existing) {
      if (JSON.stringify(comparable(existing)) !== JSON.stringify(row)) {
        throw new Error("observations: mapping drift for record " + row.record_id + " at " + row.mapping_version +
          "; bump mappingVersion instead of rewriting an immutable observation");
      }
      continue;
    }
    inserts.push(db.prepare(
      "INSERT INTO source_observations (" +
      "record_id, release_id, source_id, mapping_version, name, latitude, longitude, supports_paper, supports_heated, " +
      "opening_hours_raw, opening_hours_json, opening_hours_status, lifecycle, publication_hold, provenance_json, attenuations_json" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      row.record_id, row.release_id, row.source_id, row.mapping_version, row.name, row.latitude, row.longitude,
      row.supports_paper, row.supports_heated, row.opening_hours_raw, row.opening_hours_json,
      row.opening_hours_status, row.lifecycle, row.publication_hold, row.provenance_json, row.attenuations_json,
    ));
  }
  if (inserts.length > 0) await db.batch(inserts);

  const { results } = await db.prepare(
    "SELECT * FROM source_observations WHERE release_id = ? AND mapping_version = ? ORDER BY record_id",
  ).bind(releaseId, adapter.mappingVersion).all<ObservationDbRow>();
  if (results.length !== records.length) {
    throw new Error("observations: release " + releaseId + " has " + results.length + " observations for " +
      adapter.mappingVersion + ", expected " + records.length);
  }
  return results.map(decode);
}
