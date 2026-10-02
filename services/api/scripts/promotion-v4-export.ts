// Local-only, row-at-a-time promotion. Neither source rows nor SQL files are materialized.
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ADDITIVE_TABLES, MULTI_SOURCE_TABLES, RELEASE_SOURCE, literal, validateRelease, type MultiSourcePromotionSource, type PromotionRegistry, type TableSpec } from "../src/pipeline/promotion.ts";
import { reviewedSource } from "../src/pipeline/registry.ts";
import { reviewedTerms } from "../src/reports/terms.ts";
import { SqliteD1 } from "../test/support/sqlite-d1.ts";
import { D1_CAPACITY_POLICY, canonicalManifestDigest, type PromotionV4Manifest } from "./promotion-v4-format.ts";

import { validateV4Tile } from "./promotion-v4-tiles.ts";

type Row = Record<string, unknown>;
const registryDefault: PromotionRegistry = { source: reviewedSource, terms: reviewedTerms };
function refuse(message: string): never { throw new Error(`promotion v4 export refused: ${message}`); }
export function sqlInsertByteLength(table: string, columns: readonly string[], values: unknown[]): number {
  let bytes = Buffer.byteLength(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ();\n`) + Math.max(0, values.length - 1) * 2;
  for (const value of values) {
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value) + 2;
      for (const character of value) if (character === "'") bytes++;
    } else bytes += Buffer.byteLength(literal(value));
  }
  return bytes;
}
function insert(table: string, columns: readonly string[], values: unknown[]): string {
  const bytes = sqlInsertByteLength(table, columns, values);
  if (bytes >= D1_CAPACITY_POLICY.statementBytes) refuse(`${table}: statement exceeds ${D1_CAPACITY_POLICY.statementBytes} bytes (${bytes} bytes); tile/value capacity must be fixed before promotion`);
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.map(literal).join(", ")});`;
}

export async function exportPromotionV4(db: DatabaseSync, outputDir: string, options: {
  chunkBytes: number; registry?: PromotionRegistry; releaseIds?: readonly number[];
}): Promise<PromotionV4Manifest> {
  if (typeof db.prepare("SELECT 1").iterate !== "function") refuse("v4 streaming export requires Node >=24 (node:sqlite iterate)");
  if (!Number.isSafeInteger(options.chunkBytes) || options.chunkBytes < D1_CAPACITY_POLICY.statementBytes || options.chunkBytes >= D1_CAPACITY_POLICY.importBytes) refuse("invalid chunk byte budget");
  if (options.releaseIds && (options.releaseIds.some(id => !Number.isSafeInteger(id) || id < 1)
    || new Set(options.releaseIds).size !== options.releaseIds.length)) refuse("release IDs must be unique positive safe integers");
  const registry = options.registry ?? registryDefault;
  const adapter = new SqliteD1(db);
  const releases: Row[] = [];
  let releaseMetadataBytes = 0;
  const releaseQuery = options.releaseIds
    ? "SELECT * FROM source_releases WHERE release_id IN (SELECT value FROM json_each(?)) ORDER BY source_id, release_id"
    : "SELECT r.* FROM source_releases r JOIN sources s USING(source_id) WHERE r.is_current=1 OR (s.kind='userReport' AND s.publication_status='approved' AND r.status='applied') ORDER BY r.source_id,r.release_id";
  const releaseRows = options.releaseIds ? db.prepare(releaseQuery).iterate(JSON.stringify(options.releaseIds)) : db.prepare(releaseQuery).iterate();
  for (const row of releaseRows) {
    const source = db.prepare("SELECT * FROM sources WHERE source_id=?").get(row.source_id) as Row | undefined;
    if (!options.releaseIds && source?.kind === "userReport" && registry.source(String(source.source_id)).publicationStatus !== "approved") continue;
    await validateRelease(adapter, Number(row.release_id), source ? [source] : [], row, registry);
    const descriptor = { release_id: row.release_id, source_id: row.source_id, observed_on: row.observed_on, content_sha256: row.content_sha256 };
    releaseMetadataBytes += Buffer.byteLength(JSON.stringify(descriptor));
    if (releaseMetadataBytes > D1_CAPACITY_POLICY.maxManifestBytes) refuse("release declarations exceed bounded manifest budget");
    releases.push(descriptor);
  }
  if (!releases.length) refuse("no applied releases");
  if (options.releaseIds && new Set(options.releaseIds).size !== releases.length) refuse("requested release set is incomplete");
  const anchors = releases.filter((r, i) => i === 0 || r.source_id !== releases[i - 1].source_id);
  const sources: Row[] = [];
  let sourceMetadataBytes = 0;
  for (const anchor of anchors) {
    const source = db.prepare("SELECT * FROM sources WHERE source_id=?").get(anchor.source_id) as Row;
    sourceMetadataBytes += Buffer.byteLength(JSON.stringify(source));
    if (sourceMetadataBytes > D1_CAPACITY_POLICY.maxManifestBytes) refuse("source declarations exceed bounded manifest budget");
    sources.push(source);
  }
  for (const source of sources) if (source.kind !== "userReport" && releases.filter((r) => r.source_id === source.source_id).length !== 1) refuse("multiple current releases for source");
  const additive = sources.some((s) => s.kind === "userReport");
  const specs = additive ? ADDITIVE_TABLES : MULTI_SOURCE_TABLES;
  const releaseIds = releases.map((r) => Number(r.release_id));
  const anchorIds = anchors.map((r) => Number(r.release_id));
  function query(spec: TableSpec, ids = releaseIds, sourceAnchors = anchorIds): { sql: string; args: string[] } {
    const scoped = spec.sql.includes("?");
    const perSource = spec.sql.includes(RELEASE_SOURCE);
    let sql = spec.sql.replaceAll(`= (${RELEASE_SOURCE})`, "IN (SELECT source_id FROM source_releases WHERE release_id IN (SELECT value FROM json_each(?)))");
    sql = sql.replaceAll("release_id = ?", "release_id IN (SELECT value FROM json_each(?))");
    return { sql, args: scoped ? Array(sql.split("?").length - 1).fill(JSON.stringify(perSource ? sourceAnchors : ids)) : [] };
  }
  function count(sql: string, args: string[] = []): number { return Number((db.prepare(`SELECT count(*) AS n FROM (${sql})`).get(...args) as { n: number }).n); }
  const rows: Record<string, number> = {};
  for (const spec of specs) { const q = query(spec); rows[spec.table] = count(q.sql, q.args); }
  if (!rows.tile_snapshots) refuse("no published tiles");
  let declarationBytes = 0;
  const declarations: MultiSourcePromotionSource[] = anchors.map((release, index) => {
    const source = sources[index], id = String(source.source_id);
    const own = releases.filter((r) => r.source_id === id);
    const ownIds = own.map((r) => Number(r.release_id));
    const ownRows: Record<string, number> = {};
    for (const table of ["source_releases", "source_records", "source_record_match_keys", "source_entities", "promotion_review_match_attestations", "source_record_entities", "spot_source_entities", "spot_field_provenance"]) {
      const q = query(specs.find((s) => s.table === table)!, ownIds, [Number(release.release_id)]);
      const filter = table === "spot_source_entities" ? " WHERE source_entity_id IN (SELECT source_entity_id FROM source_entities WHERE source_id=?)"
        : table === "spot_field_provenance" ? " WHERE record_id IN (SELECT record_id FROM source_records WHERE release_id IN (SELECT value FROM json_each(?)))" : "";
      ownRows[table] = count(`SELECT * FROM (${q.sql})${filter}`, [...q.args, ...(filter ? [table === "spot_source_entities" ? id : JSON.stringify(ownIds)] : [])]);
    }
    const attest = query(specs.find((s) => s.table === "promotion_review_match_attestations")!, ownIds);
    const reviewDependencies: MultiSourcePromotionSource["reviewDependencies"] = [];
    for (const a of db.prepare(attest.sql).iterate(...attest.args)) {
      reviewDependencies.push({ recordId: Number(a.record_id), previousReleaseId: Number(a.previous_release_id), previousReleaseContentSha256: String(a.previous_release_content_sha256) });
      if (Buffer.byteLength(JSON.stringify(reviewDependencies)) > D1_CAPACITY_POLICY.statementBytes / 2) refuse("review dependencies exceed safe declaration budget");
    }
    const declaration = { sourceId: id, releaseId: Number(release.release_id), observedOn: release.observed_on === null ? null : String(release.observed_on), releaseContentSha256: String(release.content_sha256), displayName: String(source.display_name), licenseName: source.license_name === null ? null : String(source.license_name), licenseUrl: source.license_url === null ? null : String(source.license_url), attributionText: String(source.attribution_text), rows: ownRows, reviewDependencies, ...(source.kind === "userReport" ? { additiveReleases: own.map((r) => ({ releaseId: Number(r.release_id), releaseContentSha256: String(r.content_sha256) })) } : {}) };
    declarationBytes += Buffer.byteLength(JSON.stringify(declaration));
    if (declarationBytes > D1_CAPACITY_POLICY.maxManifestBytes) refuse("source declarations exceed manifest capacity");
    return declaration;
  });
  const scratchDir = mkdtempSync(join(tmpdir(), "mannerpath-v4-export-"));
  const scratch = new DatabaseSync(join(scratchDir, "validation.sqlite"));
  let outputCreated = false, fd: number | undefined;
  try {
    scratch.exec("PRAGMA foreign_keys=ON; PRAGMA cache_size=-2048; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE;");
    for (const migration of readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) scratch.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
    mkdirSync(outputDir); outputCreated = true;
    const chunks: PromotionV4Manifest["chunks"] = [];
    let hash = createHash("sha256"), bytes = 0, statements = 0, chunkRows: Record<string, number> = {};
    const tiles: PromotionV4Manifest["tiles"] = [];
    let tileMetadataBytes = 0;
    function finish(): void {
      if (fd === undefined) return;
      closeSync(fd); fd = undefined;
      const ordinal = chunks.length + 1;
      chunks.push({ ordinal, file: `chunk-${String(ordinal).padStart(4, "0")}.sql`, sha256: hash.digest("hex"), bytes, statements, rows: chunkRows });
      hash = createHash("sha256"); bytes = 0; statements = 0; chunkRows = {};
    }
    function write(sql: string, table?: string): void {
      const data = Buffer.from(sql + "\n");
      if (data.length >= D1_CAPACITY_POLICY.statementBytes) refuse(`${table ?? "declaration"}: statement is ${data.length} bytes; tile/value capacity must be fixed before promotion`);
      if (fd !== undefined && bytes + data.length > options.chunkBytes) finish();
      if (fd === undefined) fd = openSync(join(outputDir, `chunk-${String(chunks.length + 1).padStart(4, "0")}.sql`), "wx");
      scratch.exec(sql);
      writeSync(fd, data); hash.update(data); bytes += data.length; statements++;
      if (table) chunkRows[table] = (chunkRows[table] ?? 0) + 1;
    }
    write(insert("promotion_multi_bootstraps", ["promotion_bootstrap_id", "bundle_version", "source_count", "expected_rows_json"], [1, "promotion-bundle.v3", declarations.length, JSON.stringify(rows)]), "promotion_multi_bootstraps");
    for (const d of declarations) write(insert("promotion_multi_bootstrap_sources", ["source_id", "promotion_bootstrap_id", "release_id", "release_content_sha256", "display_name", "license_name", "license_url", "attribution_text", "review_dependencies_json", "expected_rows_json"], [d.sourceId, 1, d.releaseId, d.releaseContentSha256, d.displayName, d.licenseName, d.licenseUrl, d.attributionText, JSON.stringify(d.reviewDependencies), JSON.stringify(d.rows)]), "promotion_multi_bootstrap_sources");
    for (const d of declarations) for (const a of d.additiveReleases ?? []) write(insert("promotion_multi_bootstrap_additive_releases", ["release_id", "source_id", "release_content_sha256"], [a.releaseId, d.sourceId, a.releaseContentSha256]), "promotion_multi_bootstrap_additive_releases");
    for (const spec of specs) {
      const q = query(spec);
      for (const row of db.prepare(q.sql).iterate(...q.args)) {
        if (Object.values(row).some((v) => typeof v === "string" && Buffer.byteLength(v) > D1_CAPACITY_POLICY.rowBytes)) refuse(`${spec.table}: value exceeds D1 row capacity`);
        if (Object.keys(row).sort().join(",") !== [...spec.columns].sort().join(",")) refuse(`${spec.table}: exported column list drift`);
        if (spec.table === "report_terms_versions") {
          const terms = registry.terms(String(row.terms_version));
          if (terms.publicationRights !== "granted" || row.document_path !== terms.documentPath || row.document_sha256 !== terms.documentSha256) refuse("community terms differ from reviewed rights");
        }
        // Budget check precedes tile parsing, so one huge tile cannot expand exporter memory.
        const sql = insert(spec.table, spec.columns, spec.columns.map((c) => row[c]));
        if (Buffer.byteLength(sql + "\n") >= D1_CAPACITY_POLICY.statementBytes) refuse(`${spec.table}: statement is ${Buffer.byteLength(sql + "\n")} bytes; tile/value capacity must be fixed before promotion`);
        if (spec.table === "tile_snapshots") {
          tiles.push(await validateV4Tile(db, row, sources));
          tileMetadataBytes += Buffer.byteLength(JSON.stringify(tiles[tiles.length - 1]));
          if (tileMetadataBytes > D1_CAPACITY_POLICY.maxManifestBytes / 2) refuse("tile declarations exceed manifest capacity");
        }
        write(sql, spec.table);
      }
    }
    finish();
    const finalizeSql = "INSERT INTO promotion_multi_bootstrap_completions (promotion_bootstrap_id) VALUES (1);\n";
    scratch.exec(finalizeSql);
    writeFileSync(join(outputDir, "finalize.sql"), finalizeSql, { flag: "wx" });
    const unsigned = { bundleVersion: "promotion-bundle.v4" as const, capacityPolicy: D1_CAPACITY_POLICY.version, chunkTargetBytes: options.chunkBytes, sources: declarations, rows, tiles, chunks, finalize: { file: "finalize.sql", sha256: createHash("sha256").update(finalizeSql).digest("hex"), bytes: Buffer.byteLength(finalizeSql), statements: 1 } };
    const manifest: PromotionV4Manifest = { ...unsigned, wholeBundleSha256: canonicalManifestDigest(unsigned) };
    const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
    if (Buffer.byteLength(manifestJson) > D1_CAPACITY_POLICY.maxManifestBytes) refuse("manifest exceeds capacity");
    writeFileSync(join(outputDir, "manifest.json"), manifestJson, { flag: "wx" });
    return manifest;
  } catch (error) {
    if (fd !== undefined) { closeSync(fd); fd = undefined; }
    if (outputCreated) rmSync(outputDir, { recursive: true, force: true });
    throw error;
  } finally { scratch.close(); rmSync(scratchDir, { recursive: true, force: true }); }
}
