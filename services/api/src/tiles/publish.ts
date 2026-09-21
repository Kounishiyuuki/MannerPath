// Publish step (ADR-0005/0006): rebuilds the complete snapshot of every tile whose published content
// changed and writes all of them in one batch. A spot is published only if it is active, unmerged,
// under no publication hold, and its existence evidence comes from an applied release of an
// approved source; the tile_snapshot_spots trigger re-checks exactly that on insert. Spots from blocked sources are
// reported as excluded, never published.

import { type Db, sha256Hex } from "../db.ts";
import { TILE_SCHEMA_VERSION, TileBodyV1, type TileSourceV1, type TileSpotV1 } from "./dto.ts";

export interface CandidateRow {
  spot_id: string;
  name: string | null;
  latitude: number;
  longitude: number;
  tile_id: string;
  tile_z: number;
  tile_x: number;
  tile_y: number;
  spot_type: TileSpotV1["spotType"];
  access_type: TileSpotV1["accessType"];
  environment: TileSpotV1["environment"];
  supports_paper: TileSpotV1["supportsPaper"];
  supports_heated: TileSpotV1["supportsHeated"];
  opening_hours_raw: string | null;
  opening_hours_json: string | null;
  opening_hours_status: TileSpotV1["openingHours"]["status"];
  time_zone: string;
  evidence_quality: string;
  evidence_quality_version: string;
  last_verified_at: string | null;
  source_id: string;
  display_name: string;
  license_name: string | null;
  license_url: string | null;
  attribution_text: string | null;
  publication_status: "approved" | "blocked";
}

export interface PublishReport {
  published: { tileId: string; revision: number; spotCount: number; contentSha256: string }[];
  unchanged: string[];
  excluded: { sourceId: string; publicationStatus: string; spotCount: number }[];
}

export function spotDto(r: CandidateRow): TileSpotV1 {
  const p = r.opening_hours_json === null ? null : JSON.parse(r.opening_hours_json);
  const parsed = p === null ? null
    : p.kind === "daily" ? { v: p.v, kind: p.kind, opens: p.opens, closes: p.closes }
    : { v: p.v, kind: p.kind };
  return {
    id: r.spot_id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    spotType: r.spot_type,
    accessType: r.access_type,
    environment: r.environment,
    supportsPaper: r.supports_paper,
    supportsHeated: r.supports_heated,
    openingHours: { status: r.opening_hours_status, raw: r.opening_hours_raw, parsed, timeZone: r.time_zone },
    lifecycle: "active",
    evidenceQuality: r.evidence_quality,
    evidenceQualityVersion: r.evidence_quality_version,
    lastVerifiedAt: r.last_verified_at,
    sourceIds: [r.source_id],
  };
}

export function sourceDto(r: CandidateRow): TileSourceV1 {
  return {
    id: r.source_id,
    displayName: r.display_name,
    licenseName: r.license_name,
    licenseUrl: r.license_url,
    attributionText: r.attribution_text,
  };
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function publishTiles(db: Db, opts: { now: string }): Promise<PublishReport> {
  const { results: candidates } = await db.prepare(
    `SELECT s.spot_id, s.name, s.latitude, s.longitude, s.tile_id, s.tile_z, s.tile_x, s.tile_y, s.spot_type,
            s.access_type, s.environment, s.supports_paper, s.supports_heated, s.opening_hours_raw,
            s.opening_hours_json, s.opening_hours_status, s.time_zone, s.evidence_quality,
            s.evidence_quality_version, s.last_verified_at,
            src.source_id, src.display_name, src.license_name, src.license_url, src.attribution_text, src.publication_status
     FROM spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     JOIN sources src ON src.source_id = rel.source_id
     WHERE s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL
       AND rel.status = 'applied'
     ORDER BY s.spot_id`,
  ).all<CandidateRow>();

  const excluded = new Map<string, { sourceId: string; publicationStatus: string; spotCount: number }>();
  const tiles = new Map<string, { z: number; x: number; y: number; rows: CandidateRow[] }>();
  for (const row of candidates) {
    if (row.publication_status !== "approved") {
      const e = excluded.get(row.source_id) ?? { sourceId: row.source_id, publicationStatus: row.publication_status, spotCount: 0 };
      e.spotCount++;
      excluded.set(row.source_id, e);
      continue;
    }
    const t = tiles.get(row.tile_id) ?? { z: row.tile_z, x: row.tile_x, y: row.tile_y, rows: [] };
    t.rows.push(row);
    tiles.set(row.tile_id, t);
  }

  // Tiles published before must be rebuilt too: they may now be empty (snapshots are complete).
  const { results: existing } = await db.prepare(
    "SELECT tile_id, z, x, y, revision, body_json FROM tile_snapshots",
  ).all<{ tile_id: string; z: number; x: number; y: number; revision: number; body_json: string }>();
  const previous = new Map(existing.map((e) => [e.tile_id, e]));
  for (const e of existing) if (!tiles.has(e.tile_id)) tiles.set(e.tile_id, { z: e.z, x: e.x, y: e.y, rows: [] });

  const report: PublishReport = { published: [], unchanged: [], excluded: [...excluded.values()] };
  const clears = [];
  const upserts = [];
  const inserts = [];
  for (const tileId of [...tiles.keys()].sort()) {
    const t = tiles.get(tileId)!;
    const spots = t.rows.map(spotDto).sort(byId);
    const sources = [...new Map(t.rows.map((r) => [r.source_id, sourceDto(r)])).values()].sort(byId);
    const content = JSON.stringify({ spots, sources });
    const prev = previous.get(tileId);
    if (prev) {
      const old = JSON.parse(prev.body_json);
      if (old.schemaVersion === TILE_SCHEMA_VERSION && JSON.stringify({ spots: old.spots, sources: old.sources }) === content) {
        report.unchanged.push(tileId);
        continue;
      }
    }
    const revision = (prev?.revision ?? 0) + 1;
    const body: TileBodyV1 = { schemaVersion: TILE_SCHEMA_VERSION, tile: tileId, revision, generatedAt: opts.now, spots, sources };
    TileBodyV1.parse(body);
    const bodyJson = JSON.stringify(body);
    const contentSha256 = await sha256Hex(bodyJson);
    clears.push(db.prepare("DELETE FROM tile_snapshot_spots WHERE tile_id = ?").bind(tileId));
    upserts.push(db.prepare(
      `INSERT INTO tile_snapshots (tile_id, z, x, y, revision, schema_version, content_sha256, spot_count, body_json, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tile_id) DO UPDATE SET revision = excluded.revision, schema_version = excluded.schema_version,
         content_sha256 = excluded.content_sha256, spot_count = excluded.spot_count, body_json = excluded.body_json,
         published_at = excluded.published_at`,
    ).bind(tileId, t.z, t.x, t.y, revision, TILE_SCHEMA_VERSION, contentSha256, spots.length, bodyJson, opts.now));
    for (const s of spots) {
      inserts.push(db.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").bind(s.id, tileId));
    }
    report.published.push({ tileId, revision, spotCount: spots.length, contentSha256 });
  }
  // Clears first, so a spot that moved between two republished tiles can be re-inserted.
  if (upserts.length > 0) await db.batch([...clears, ...upserts, ...inserts]);
  return report;
}
