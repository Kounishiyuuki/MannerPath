// First-release reconciliation + resolution for a Taito-format release, as one batch:
// source entity + 'new' decision per record, one canonical spot per entity, field provenance, and
// the release marked applied/current. A second release of the same source is refused: matching
// records across releases needs a matcher validated on two real releases (ADR-0006, research §7).

import { type Db } from "../db.ts";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../geo/tile.ts";
import { newSpotId as defaultNewSpotId } from "../spot-id.ts";
import { TAITO_PARSER_VERSION, TAITO_RESOLVER_VERSION, resolveTaitoRecord } from "./taito.ts";

export const FIRST_RELEASE_MATCHER_VERSION = "first-release.v1";
// Evidence-quality vocabulary v1 has one value: listed in the current applied release of an
// official (municipal/government) source. Other values arrive with the sources that need them.
export const EVIDENCE_QUALITY_VERSION = "evidence-quality.v1";
export const OFFICIAL_LISTING = "officialListing";

export interface ResolveOptions {
  now: string;
  newSpotId?: () => string;
}

export type ResolveResult =
  | { status: "resolved"; spotIds: string[] }
  | { status: "alreadyApplied" };

export async function resolveFirstRelease(db: Db, releaseId: number, opts: ResolveOptions): Promise<ResolveResult> {
  const newSpotId = opts.newSpotId ?? defaultNewSpotId;
  const release = await db.prepare(
    `SELECT r.source_id, r.observed_on, r.status, r.parser_version, s.kind
     FROM source_releases r JOIN sources s ON s.source_id = r.source_id WHERE r.release_id = ?`,
  ).bind(releaseId).first<{ source_id: string; observed_on: string | null; status: string; parser_version: string; kind: string }>();
  if (!release) throw new Error(`resolve: release ${releaseId} does not exist`);
  if (release.status === "applied") return { status: "alreadyApplied" };
  if (release.status !== "ingested") throw new Error(`resolve: release ${releaseId} is ${release.status}`);
  if (release.parser_version !== TAITO_PARSER_VERSION) {
    throw new Error(`resolve: release ${releaseId} was parsed by ${release.parser_version}, not ${TAITO_PARSER_VERSION}`);
  }
  if (release.kind !== "municipal") {
    throw new Error(`resolve: ${OFFICIAL_LISTING} requires a municipal source, ${release.source_id} is ${release.kind}`);
  }
  const previous = await db.prepare(
    "SELECT release_id FROM source_releases WHERE source_id = ? AND status = 'applied' AND release_id <> ?",
  ).bind(release.source_id, releaseId).first<{ release_id: number }>();
  if (previous) {
    throw new Error(
      `resolve: ${release.source_id} already has applied release ${previous.release_id}; ` +
        "cross-release reconciliation is not implemented until a matcher is validated on two real releases",
    );
  }

  const { results: records } = await db.prepare(
    "SELECT record_id, raw_values_json FROM source_records WHERE release_id = ? ORDER BY ordinal",
  ).bind(releaseId).all<{ record_id: number; raw_values_json: string }>();
  if (records.length === 0) throw new Error(`resolve: release ${releaseId} has no records`);

  const now = opts.now;
  const statements = [];
  const spotIds: string[] = [];
  for (const record of records) {
    const r = resolveTaitoRecord(JSON.parse(record.raw_values_json));
    const tile = tileForCoordinate(r.latitude, r.longitude, DATA_TILE_ZOOM);
    const spotId = newSpotId();
    spotIds.push(spotId);
    statements.push(
      db.prepare(
        `INSERT INTO source_entities (source_entity_id, source_id, created_at)
         VALUES ((SELECT COALESCE(MAX(source_entity_id), 0) + 1 FROM source_entities), ?, ?)`,
      ).bind(release.source_id, now),
      db.prepare(
        `INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at, note)
         VALUES (?, ?, (SELECT MAX(source_entity_id) FROM source_entities), 'new', ?, ?, ?)`,
      ).bind(record.record_id, releaseId, FIRST_RELEASE_MATCHER_VERSION, now, "first known release of this source; no cross-release match attempted"),
      db.prepare(
        `INSERT INTO spots (spot_id, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type,
           supports_paper, supports_heated, opening_hours_raw, opening_hours_json, opening_hours_status,
           lifecycle, evidence_quality, evidence_quality_version, last_verified_at, resolver_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      ).bind(spotId, r.name, r.latitude, r.longitude, tile.z, tile.x, tile.y, formatTileId(tile),
        r.supportsPaper, r.supportsHeated, r.openingHours.raw,
        r.openingHours.parsed ? JSON.stringify(r.openingHours.parsed) : null, r.openingHours.status,
        OFFICIAL_LISTING, EVIDENCE_QUALITY_VERSION, release.observed_on, TAITO_RESOLVER_VERSION, now, now),
      db.prepare(
        `INSERT INTO spot_source_entities (source_entity_id, spot_id, method, linked_at, resolver_version)
         VALUES ((SELECT source_entity_id FROM source_record_entities WHERE record_id = ?), ?, 'created', ?, ?)`,
      ).bind(record.record_id, spotId, now, TAITO_RESOLVER_VERSION),
      ...r.provenance.map((p) =>
        db.prepare(
          `INSERT INTO spot_field_provenance (spot_id, field, record_id, source_columns_json, rule, resolver_version, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(spotId, p.field, record.record_id, JSON.stringify(p.columns), p.rule, TAITO_RESOLVER_VERSION, now),
      ),
    );
  }
  statements.push(
    db.prepare("UPDATE source_releases SET status = 'applied', applied_at = ?, is_current = 1 WHERE release_id = ?").bind(now, releaseId),
  );
  await db.batch(statements);
  return { status: "resolved", spotIds };
}
