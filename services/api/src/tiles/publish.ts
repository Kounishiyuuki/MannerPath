// Publish step (ADR-0005/0006/0015): rebuilds the complete snapshot of every tile whose published content
// changed and writes all of them in one batch: each tile as a manifest row plus bounded part rows (ADR-0015). A spot is published only if it is active, unmerged,
// under no publication hold, has no pending relocation application (0015), and its existence evidence comes from an applied release of an
// approved source; the tile_snapshot_spots trigger re-checks exactly that on insert. Spots from blocked sources are
// reported as excluded, never published. Two community gates sit on top (migration 0021, Issue #124/#127): a
// community spot needs evidence consented under a granted terms version (else excluded as `rightsNotGranted`), and
// a spot under an active community publication hold (0021) or absence hold (0024) is not a candidate at all.

import { type Db, sha256Hex } from "../db.ts";
import { SPOT_VERIFICATION_VERSION, type SpotVerificationV1, TILE_SCHEMA_VERSION, type TileSourceV1, type TileSpotV1 } from "./dto.ts";
import { manifestBody, splitTileParts } from "./parts.ts";

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
  spot_subtype: TileSpotV1["spotSubtype"];
  host_type: TileSpotV1["hostType"] | null;
  access_detail: TileSpotV1["accessDetail"];
  community_confirmations: number | null;
  last_reviewed_on: string | null;
  source_id: string;
  source_kind: string;
  display_name: string;
  license_name: string | null;
  license_url: string | null;
  attribution_text: string | null;
  publication_status: "approved" | "blocked";
  /** 1 or 0 for a community (userReport) spot's rights basis (0021 community_spot_rights); null for any other spot. */
  community_rights_granted?: number | null;
  /**
   * ADR-0017 (0030 spot_location_anchors): `areaApproximate` while an anchor binding is active, the upgraded precision
   * after a precision-only upgrade, null for a spot that was never anchored. With its area name and kind.
   */
  location_precision_override?: "areaApproximate" | "publisherPoint" | "communityPinned" | null;
  location_area_name?: string | null;
  location_area_kind?: NonNullable<SpotVerificationV1["locationArea"]>["kind"] | null;
  /** The location provenance rule; an area-anchor rule without an active or upgraded binding is never published. */
  location_rule?: string | null;
}

/** Columns and joins every reader of a published spot uses for its location precision (ADR-0017). */
export const LOCATION_ANCHOR_COLUMNS = `CASE WHEN la.spot_id IS NULL THEN NULL WHEN la.ended_at IS NULL THEN 'areaApproximate'
            ELSE la.upgraded_precision END AS location_precision_override,
            CASE WHEN la.ended_at IS NULL THEN aa.area_name END AS location_area_name,
            CASE WHEN la.ended_at IS NULL THEN aa.area_kind END AS location_area_kind,
            (SELECT lp.rule FROM spot_field_provenance lp WHERE lp.spot_id = s.spot_id AND lp.field = 'location') AS location_rule`;
export const LOCATION_ANCHOR_JOINS = `LEFT JOIN spot_location_anchors la ON la.spot_id = s.spot_id
     LEFT JOIN area_location_anchors aa ON aa.anchor_id = la.anchor_id`;

/** An area-anchor location without its binding has lost its provenance: fail closed rather than look exact. */
export function anchorProvenanceMissing(r: CandidateRow): boolean {
  return (r.location_rule ?? "").startsWith("area-anchor.") && (r.location_precision_override ?? null) === null;
}

export interface PublishReport {
  published: { tileId: string; revision: number; spotCount: number; contentSha256: string }[];
  unchanged: string[];
  excluded: { sourceId: string; publicationStatus: string; spotCount: number }[];
}

/**
 * The ADR-0012 trust axes, derived from the evidence's source kind and the spot's recorded evidence. Nothing here
 * is a score: each axis is a named fact, and an unknown stays unknown.
 */
export function verificationDto(r: CandidateRow): SpotVerificationV1 {
  const community = r.source_kind === "userReport";
  const existence = community
    ? (r.evidence_quality === "communityReported" ? "communityReported" : "communityVerified")
    : r.source_kind === "operator" ? "operator" : "official";
  return {
    version: SPOT_VERIFICATION_VERSION,
    existence,
    locationPrecision: r.location_precision_override ?? (community ? "communityPinned"
      : r.evidence_quality === "officialListingDerivedLocation" ? "reviewedDerived" : "publisherPoint"),
    confirmations: community ? r.community_confirmations : null,
    lastReviewedMonth: (community ? r.last_reviewed_on : r.last_verified_at)?.slice(0, 7) ?? null,
    ...(r.location_precision_override === "areaApproximate"
      ? { locationArea: { name: r.location_area_name!, kind: r.location_area_kind! } } : {}),
  };
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
    spotSubtype: r.spot_subtype,
    hostType: r.host_type ?? "unknown",
    accessDetail: r.access_detail,
    verification: verificationDto(r),
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
            s.evidence_quality_version, s.last_verified_at, s.spot_subtype, s.host_type, s.access_detail,
            s.community_confirmations, s.last_reviewed_on,
            src.source_id, src.kind AS source_kind, src.display_name, src.license_name, src.license_url, src.attribution_text, src.publication_status,
            cr.rights_granted AS community_rights_granted, ${LOCATION_ANCHOR_COLUMNS}
     FROM spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     JOIN sources src ON src.source_id = rel.source_id
     LEFT JOIN community_spot_rights cr ON cr.spot_id = s.spot_id
     ${LOCATION_ANCHOR_JOINS}
     WHERE s.lifecycle = 'active' AND s.merged_into IS NULL AND s.publication_hold IS NULL
       AND s.spot_id NOT IN (SELECT spot_id FROM community_publication_holds WHERE lifted_at IS NULL)
       AND s.spot_id NOT IN (SELECT spot_id FROM community_absence_holds WHERE lifted_at IS NULL)
       -- A survivor held by an unresolved cross-source merge conflict (0019) is not a candidate.
       AND s.spot_id NOT IN (SELECT spot_id FROM cross_source_publication_blocks)
       AND rel.status = 'applied'
       AND NOT EXISTS (SELECT 1 FROM pending_relocation_applications x WHERE x.spot_id = s.spot_id)
     ORDER BY s.spot_id`,
  ).all<CandidateRow>();

  const excluded = new Map<string, { sourceId: string; publicationStatus: string; spotCount: number }>();
  const tiles = new Map<string, { z: number; x: number; y: number; rows: CandidateRow[] }>();
  for (const row of candidates) {
    const status = row.publication_status !== "approved" ? row.publication_status
      : row.community_rights_granted === 0 ? "rightsNotGranted"
      : anchorProvenanceMissing(row) ? "anchorProvenanceMissing" : null;
    if (status !== null) {
      const key = `${row.source_id}\n${status}`;
      const e = excluded.get(key) ?? { sourceId: row.source_id, publicationStatus: status, spotCount: 0 };
      e.spotCount++;
      excluded.set(key, e);
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
    const sourcesById = new Map(t.rows.map((r) => [r.source_id, sourceDto(r)]));
    const parts = await splitTileParts(tileId, spots, sourcesById);
    const prev = previous.get(tileId);
    if (prev) {
      // Parts are content-addressed, so an equal part list is equal content. A pre-ADR-0015 (schemaVersion 1) body
      // always republishes, which is how an existing database converts to parts.
      const old = JSON.parse(prev.body_json);
      if (old.schemaVersion === TILE_SCHEMA_VERSION
        && JSON.stringify(old.parts.map((p: { sha256: string }) => p.sha256)) === JSON.stringify(parts.map((p) => p.sha256))) {
        report.unchanged.push(tileId);
        continue;
      }
    }
    const revision = (prev?.revision ?? 0) + 1;
    const manifestJson = JSON.stringify(manifestBody(tileId, revision, opts.now, parts));
    const contentSha256 = await sha256Hex(manifestJson);
    clears.push(db.prepare("DELETE FROM tile_snapshot_spots WHERE tile_id = ?").bind(tileId));
    clears.push(db.prepare("DELETE FROM tile_snapshot_parts WHERE tile_id = ?").bind(tileId));
    upserts.push(db.prepare(
      `INSERT INTO tile_snapshots (tile_id, z, x, y, revision, schema_version, content_sha256, spot_count, body_json, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tile_id) DO UPDATE SET revision = excluded.revision, schema_version = excluded.schema_version,
         content_sha256 = excluded.content_sha256, spot_count = excluded.spot_count, body_json = excluded.body_json,
         published_at = excluded.published_at`,
    ).bind(tileId, t.z, t.x, t.y, revision, TILE_SCHEMA_VERSION, contentSha256, spots.length, manifestJson, opts.now));
    for (const p of parts) {
      inserts.push(db.prepare(
        "INSERT INTO tile_snapshot_parts (tile_id, part_index, content_sha256, spot_count, body_json) VALUES (?, ?, ?, ?, ?)",
      ).bind(tileId, p.index, p.sha256, p.spotCount, p.bodyJson));
    }
    for (const s of spots) {
      inserts.push(db.prepare("INSERT INTO tile_snapshot_spots (spot_id, tile_id) VALUES (?, ?)").bind(s.id, tileId));
    }
    report.published.push({ tileId, revision, spotCount: spots.length, contentSha256 });
  }
  // Clears first, so a spot that moved between two republished tiles can be re-inserted.
  if (upserts.length > 0) await db.batch([...clears, ...upserts, ...inserts]);
  return report;
}
