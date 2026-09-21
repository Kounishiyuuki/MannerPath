// Promotion bundle (docs/OPERATIONS.md): the deterministic, reviewable artifact that carries one
// validated *local* release's published state to another database.
//
// It is a BOOTSTRAP artifact: INSERT-only, for an empty, freshly migrated target database. It cannot
// update a populated one, and this slice deliberately adds no upsert path — corrected data ships by
// promoting a new database and switching the Worker's binding (the blue/green procedure in
// docs/OPERATIONS.md). Applying a bundle to a populated database fails on primary keys, which is what
// keeps a half-applied update from ever existing.
//
// It is a pure read of a local database plus a text serialisation. Nothing here opens a connection,
// and nothing here applies anything: the caller writes a file, a human reads it, and a human runs
// `wrangler d1 execute ... --remote --file`. That split is the point — the repository never grows a
// code path that can write to a remote database.
//
// Three properties make the artifact reviewable:
//   1. Deterministic. Fixed table order, fixed column order, fixed row order, fixed literal
//      formatting. The same database produces byte-identical output, so two bundles can be diffed.
//   2. Complete for the selected release. Evidence (release, records, match keys), identity
//      (entities, decisions), canonical spots with field provenance, and the published tile
//      snapshots — in foreign-key-safe order, so the publication trigger re-checks every published
//      spot on the receiving side rather than trusting this file.
//   3. Validated, or nothing. Every check below fails the export; a partial or unapproved bundle is
//      never emitted.
//
// Deliberately absent: the report tables (user-submitted content and hashed submitter keys never
// leave a database through this path, ADR-0007), and `d1_migrations` (the receiver runs the real
// migrations first).

import { type Db, sha256Hex } from "../db.ts";
import { TileBodyV1 } from "../tiles/dto.ts";
import { reviewedSource } from "./registry.ts";

export const PROMOTION_BUNDLE_VERSION = "promotion-bundle.v1";

export interface PromotionManifest {
  generator: string;
  releaseId: number;
  sourceId: string;
  observedOn: string | null;
  releaseContentSha256: string;
  tiles: { tileId: string; revision: number; spotCount: number; contentSha256: string }[];
  rows: Record<string, number>;
  /** sha256 of the statement block, so a reviewed bundle can be identified by one value. */
  contentSha256: string;
}

export interface PromotionBundle {
  sql: string;
  manifest: PromotionManifest;
}

export class PromotionError extends Error {}

function fail(detail: string): never {
  throw new PromotionError(`promotion export refused: ${detail}`);
}

/**
 * SQLite literal. Numbers keep their shortest round-trip form, strings are single-quoted with
 * doubled quotes. A carriage return or NUL is refused rather than escaped: this artifact is read by
 * a human and split on semicolons by the applying tool, so an invisible control character in it is
 * a hazard, not a value worth preserving.
 */
function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`non-finite numeric value ${value}`);
    return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  }
  if (typeof value === "string") {
    if (/[\r\0]/.test(value)) fail("a value contains a carriage return or NUL byte");
    return `'${value.replaceAll("'", "''")}'`;
  }
  fail(`unsupported value type ${typeof value}`);
}

/**
 * The tables the bundle carries, in foreign-key-safe order, each with its explicit column list and
 * a deterministic ORDER BY. `sql` takes the release id as its single bound parameter. Adding a table here
 * is a deliberate decision about what may leave a database.
 */
interface TableSpec {
  table: string;
  columns: string[];
  sql: string;
}

const PUBLISHED_SPOTS = "SELECT spot_id FROM tile_snapshot_spots";
const RELEASE_SOURCE = "SELECT source_id FROM source_releases WHERE release_id = ?";

const TABLES: readonly TableSpec[] = [
  {
    table: "sources",
    columns: ["source_id", "display_name", "kind", "license_name", "license_url", "attribution_text", "publication_status", "created_at", "updated_at"],
    sql: `SELECT * FROM sources WHERE source_id = (${RELEASE_SOURCE}) ORDER BY source_id`,
  },
  {
    table: "source_releases",
    columns: ["release_id", "source_id", "observed_on", "fetched_at", "source_url", "http_last_modified", "content_sha256", "byte_length", "header_json", "record_count", "parser_version", "status", "is_current", "applied_at"],
    sql: "SELECT * FROM source_releases WHERE release_id = ? ORDER BY release_id",
  },
  {
    table: "source_records",
    columns: ["record_id", "release_id", "ordinal", "upstream_row_ref", "raw_values_json", "raw_sha256"],
    sql: "SELECT * FROM source_records WHERE release_id = ? ORDER BY record_id",
  },
  {
    table: "source_record_match_keys",
    columns: ["record_id", "key_version", "match_key", "derived_at"],
    sql: `SELECT k.* FROM source_record_match_keys k JOIN source_records r ON r.record_id = k.record_id
          WHERE r.release_id = ? ORDER BY k.record_id, k.key_version`,
  },
  {
    table: "source_entities",
    columns: ["source_entity_id", "source_id", "created_at"],
    sql: `SELECT * FROM source_entities WHERE source_id = (${RELEASE_SOURCE}) ORDER BY source_entity_id`,
  },
  {
    table: "source_record_entities",
    columns: ["record_id", "release_id", "source_entity_id", "method", "matcher_version", "decided_at", "note"],
    sql: "SELECT * FROM source_record_entities WHERE release_id = ? ORDER BY record_id",
  },
  {
    table: "spots",
    columns: ["spot_id", "merged_into", "name", "latitude", "longitude", "tile_z", "tile_x", "tile_y", "tile_id", "spot_type", "host_type", "access_type", "environment", "supports_paper", "supports_heated", "opening_hours_raw", "opening_hours_json", "opening_hours_status", "time_zone", "fee_type", "floor", "entrance_note", "lifecycle", "publication_hold", "evidence_quality", "evidence_quality_version", "last_verified_at", "resolver_version", "created_at", "updated_at"],
    sql: `SELECT * FROM spots WHERE spot_id IN (${PUBLISHED_SPOTS}) ORDER BY spot_id`,
  },
  {
    table: "spot_source_entities",
    columns: ["source_entity_id", "spot_id", "method", "linked_at", "resolver_version"],
    sql: `SELECT * FROM spot_source_entities WHERE spot_id IN (${PUBLISHED_SPOTS}) ORDER BY source_entity_id`,
  },
  {
    table: "spot_field_provenance",
    columns: ["spot_id", "field", "record_id", "source_columns_json", "rule", "resolver_version", "resolved_at"],
    sql: `SELECT * FROM spot_field_provenance WHERE spot_id IN (${PUBLISHED_SPOTS}) ORDER BY spot_id, field`,
  },
  {
    // The Issue #42 attenuations behind a published spot's weakened fields. Without them the
    // receiving database would hold the weakened value with no recorded evidence for it, and
    // GET /spots/{id} there would publish the attenuated field's CSV provenance as if it were the
    // evidence — exactly the misleading output the attenuation model exists to prevent.
    table: "spot_field_attenuations",
    columns: ["spot_id", "field", "effect", "attestation_version", "reference_kind", "reference_url", "checked_at", "release_id", "release_content_sha256", "release_observed_on", "release_source_url", "resolver_version", "applied_at"],
    sql: `SELECT * FROM spot_field_attenuations WHERE spot_id IN (${PUBLISHED_SPOTS}) ORDER BY spot_id, field, effect`,
  },
  {
    table: "tile_snapshots",
    columns: ["tile_id", "z", "x", "y", "revision", "schema_version", "content_sha256", "spot_count", "body_json", "published_at"],
    sql: "SELECT * FROM tile_snapshots ORDER BY tile_id",
  },
  {
    table: "tile_snapshot_spots",
    columns: ["spot_id", "tile_id"],
    sql: "SELECT * FROM tile_snapshot_spots ORDER BY spot_id",
  },
];

type Row = Record<string, unknown>;

async function rowsOf(db: Db, spec: TableSpec, releaseId: number): Promise<Row[]> {
  // Two specs carry no parameter (the published tiles are whole-database state), and binding a
  // value to a statement that has no placeholder is an error.
  const statement = db.prepare(spec.sql);
  const { results } = await (spec.sql.includes("?") ? statement.bind(releaseId) : statement).all<Row>();
  // A column added by a later migration must be added to the spec deliberately; silently dropping
  // it would produce a bundle that looks complete and is not.
  for (const row of results) {
    const actual = Object.keys(row).sort().join(",");
    const declared = [...spec.columns].sort().join(",");
    if (actual !== declared) fail(`${spec.table}: columns ${actual} do not match the exported column list ${declared}`);
  }
  return results;
}

/** The release to export when the caller did not name one: the single current applied release. */
export async function currentReleaseId(db: Db): Promise<number> {
  const { results } = await db.prepare(
    "SELECT release_id FROM source_releases WHERE is_current = 1 ORDER BY release_id",
  ).all<{ release_id: number }>();
  if (results.length === 1) return results[0].release_id;
  if (results.length === 0) fail("no current applied release exists in this database; run the pipeline first");
  fail(`${results.length} current releases exist; name one with --release <id>`);
}

async function validateRelease(db: Db, releaseId: number, sources: Row[], release: Row | undefined): Promise<void> {
  if (release === undefined) fail(`release ${releaseId} does not exist`);
  if (release.status !== "applied") fail(`release ${releaseId} has status ${String(release.status)}, not applied`);
  if (sources.length !== 1) fail(`release ${releaseId} resolved ${sources.length} source rows`);
  const source = sources[0];

  // The publication gate, checked against the reviewed registry in code — not just against the
  // row's own status column, which a local database could hold in any state (ADR-0006).
  let reviewed;
  try {
    reviewed = reviewedSource(String(source.source_id));
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  if (source.publication_status !== "approved") {
    fail(`source ${String(source.source_id)} is ${String(source.publication_status)}; only an approved source may be promoted`);
  }
  if (reviewed.publicationStatus !== "approved") {
    fail(`source ${String(source.source_id)} is not approved in REVIEWED_SOURCES`);
  }
  for (const [column, expected] of [
    ["display_name", reviewed.displayName],
    ["license_name", reviewed.licenseName],
    ["license_url", reviewed.licenseUrl],
    ["attribution_text", reviewed.attributionText],
  ] as const) {
    if (source[column] !== expected) {
      fail(`source ${String(source.source_id)}.${column} does not match the reviewed registry entry; run local:registry and republish`);
    }
  }
  if (source.attribution_text === null) fail(`source ${String(source.source_id)} has no attribution text`);
}

async function validatePublishedState(db: Db, releaseId: number, rows: Map<string, Row[]>): Promise<void> {
  const tiles = rows.get("tile_snapshots") ?? [];
  const members = rows.get("tile_snapshot_spots") ?? [];
  const spots = rows.get("spots") ?? [];
  if (tiles.length === 0) fail("no tile snapshot has been published in this database");

  // Every published spot must still satisfy the publication invariant, and must be explained by the
  // release being exported: promoting a tile whose evidence lives in a release this bundle does not
  // carry would leave the receiving database inconsistent.
  const spotById = new Map(spots.map((s) => [String(s.spot_id), s]));
  for (const member of members) {
    const spot = spotById.get(String(member.spot_id));
    if (spot === undefined) fail(`published spot ${String(member.spot_id)} has no canonical row`);
    if (spot.merged_into !== null) fail(`published spot ${String(spot.spot_id)} is merged`);
    if (spot.lifecycle !== "active") fail(`published spot ${String(spot.spot_id)} is ${String(spot.lifecycle)}`);
    if (spot.publication_hold !== null) fail(`published spot ${String(spot.spot_id)} is held: ${String(spot.publication_hold)}`);
    if (spot.tile_id !== member.tile_id) fail(`published spot ${String(spot.spot_id)} is not in tile ${String(member.tile_id)}`);
  }

  const outside = await db.prepare(
    `SELECT s.spot_id FROM tile_snapshot_spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     WHERE r.release_id <> ? ORDER BY s.spot_id`,
  ).bind(releaseId).all<{ spot_id: string }>();
  if (outside.results.length > 0) {
    fail(`${outside.results.length} published spot(s) draw existence evidence from another release (first: ${outside.results[0].spot_id}); export that release instead, or republish`);
  }

  // Provenance must not reference evidence the bundle leaves behind.
  const carried = new Set((rows.get("source_records") ?? []).map((r) => Number(r.record_id)));
  for (const p of rows.get("spot_field_provenance") ?? []) {
    if (!carried.has(Number(p.record_id))) {
      fail(`provenance for ${String(p.spot_id)}.${String(p.field)} references a record outside release ${releaseId}`);
    }
  }
  const entities = new Set((rows.get("source_entities") ?? []).map((e) => Number(e.source_entity_id)));
  for (const link of rows.get("spot_source_entities") ?? []) {
    if (!entities.has(Number(link.source_entity_id))) {
      fail(`spot ${String(link.spot_id)} links a source entity outside the exported source`);
    }
  }
}

async function validateSnapshots(rows: Map<string, Row[]>): Promise<void> {
  const members = rows.get("tile_snapshot_spots") ?? [];
  const sources = rows.get("sources") ?? [];
  for (const tile of rows.get("tile_snapshots") ?? []) {
    const tileId = String(tile.tile_id);
    const body = String(tile.body_json);
    if (await sha256Hex(body) !== tile.content_sha256) fail(`tile ${tileId}: body does not match its stored content hash`);
    const parsed = TileBodyV1.safeParse(JSON.parse(body));
    if (!parsed.success) fail(`tile ${tileId}: stored body is not a valid tile response`);
    if (parsed.data.tile !== tileId) fail(`tile ${tileId}: body names tile ${parsed.data.tile}`);
    if (parsed.data.spots.length !== tile.spot_count) fail(`tile ${tileId}: spot_count does not match the body`);

    const published = members.filter((m) => m.tile_id === tileId).map((m) => String(m.spot_id)).sort();
    const inBody = parsed.data.spots.map((s) => s.id).sort();
    if (published.join(",") !== inBody.join(",")) fail(`tile ${tileId}: snapshot membership does not match the body`);

    // Attribution travels with the data or the data does not travel (DATA_POLICY.md).
    for (const bodySource of parsed.data.sources) {
      const row = sources.find((s) => s.source_id === bodySource.id);
      if (row === undefined) fail(`tile ${tileId}: body cites source ${bodySource.id}, which this bundle does not carry`);
      if (bodySource.attributionText === null || bodySource.attributionText !== row.attribution_text) {
        fail(`tile ${tileId}: attribution for ${bodySource.id} is missing or does not match the registry row`);
      }
    }
  }
}

/**
 * Reads one validated local database and returns the promotion artifact. It never writes, and the
 * `Db` it is given is a local binding by construction — the scripts that call it open their
 * binding with `remoteBindings: false`.
 */
export async function buildPromotionBundle(db: Db, options: { releaseId?: number } = {}): Promise<PromotionBundle> {
  const releaseId = options.releaseId ?? await currentReleaseId(db);
  if (!Number.isInteger(releaseId) || releaseId < 1) fail(`release id must be a positive integer, got ${releaseId}`);

  const rows = new Map<string, Row[]>();
  for (const spec of TABLES) rows.set(spec.table, await rowsOf(db, spec, releaseId));

  await validateRelease(db, releaseId, rows.get("sources") ?? [], (rows.get("source_releases") ?? [])[0]);
  await validatePublishedState(db, releaseId, rows);
  await validateSnapshots(rows);

  const statements: string[] = [];
  for (const spec of TABLES) {
    const table = rows.get(spec.table) ?? [];
    if (table.length === 0) continue;
    statements.push(`-- ${spec.table} (${table.length})`);
    for (const row of table) {
      const values = spec.columns.map((c) => literal(row[c])).join(", ");
      statements.push(`INSERT INTO ${spec.table} (${spec.columns.join(", ")}) VALUES (${values});`);
    }
    statements.push("");
  }
  const body = statements.join("\n");
  const contentSha256 = await sha256Hex(body);

  const release = (rows.get("source_releases") ?? [])[0];
  const manifest: PromotionManifest = {
    generator: PROMOTION_BUNDLE_VERSION,
    releaseId,
    sourceId: String(release.source_id),
    observedOn: release.observed_on === null ? null : String(release.observed_on),
    releaseContentSha256: String(release.content_sha256),
    tiles: (rows.get("tile_snapshots") ?? []).map((t) => ({
      tileId: String(t.tile_id),
      revision: Number(t.revision),
      spotCount: Number(t.spot_count),
      contentSha256: String(t.content_sha256),
    })),
    rows: Object.fromEntries(TABLES.map((s) => [s.table, (rows.get(s.table) ?? []).length])),
    contentSha256,
  };

  const header = [
    "-- MannerPath promotion bundle. Generated from a validated LOCAL database; see docs/OPERATIONS.md.",
    `-- generator: ${PROMOTION_BUNDLE_VERSION}`,
    `-- release: ${releaseId} (${manifest.sourceId}, observed ${manifest.observedOn ?? "unknown"}, bytes ${manifest.releaseContentSha256})`,
    `-- rows: ${Object.entries(manifest.rows).map(([t, n]) => `${t}=${n}`).join(" ")}`,
    ...manifest.tiles.map((t) => `-- tile ${t.tileId}: revision ${t.revision}, ${t.spotCount} spot(s), ${t.contentSha256}`),
    `-- contentSha256: ${contentSha256}`,
    "--",
    "-- TARGET: an EMPTY, freshly migrated database. This bundle is INSERT-only — it bootstraps a new",
    "-- database and cannot update a populated one. To ship corrected data, create a new D1 database,",
    "-- migrate it, apply the new bundle, smoke verify, then switch the Worker's binding in a reviewed",
    "-- deployment (blue/green; docs/OPERATIONS.md). Re-applying this file to a populated database",
    "-- fails on primary keys rather than half-updating it.",
    "--",
    "-- This file contains no secret and no user report data. Applying it is an explicit human step.",
    "-- Address the target database BY NAME: while an environment's binding still points at the live",
    "-- database, --env would migrate and write to that one instead (docs/OPERATIONS.md step 6).",
    "--   npx wrangler d1 migrations apply <new-database-name> --remote",
    "--   npx wrangler d1 execute <new-database-name> --remote --file <this file>",
    "-- The receiving database re-checks the publication invariant on every tile_snapshot_spots row,",
    "-- so a tampered bundle is rejected there as well as here.",
    "",
  ].join("\n");

  return { sql: `${header}${body}`, manifest };
}
