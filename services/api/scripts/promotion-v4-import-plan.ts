// Prepare authenticated D1 atomic-file imports locally. This module never opens a remote database.
import { createHash } from "node:crypto";
import { createReadStream, closeSync, mkdirSync, openSync, rmSync, writeSync, writeFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { literal } from "../src/pipeline/promotion.ts";
import { canonicalJson, D1_CAPACITY_POLICY, type PromotionV4Manifest, type V4File } from "./promotion-v4-format.ts";
import { insertTable, readV4Manifest, sqlStatements, verifyPromotionV4 } from "./promotion-v4-verify.ts";

const controlColumns: Record<string, string[]> = {
  promotion_v4_manifests: ["id", "manifest_sha256", "capacity_policy", "expected_chunks"],
  promotion_v4_expected_sources: ["source_id", "manifest_id", "release_id", "release_content_sha256", "observed_on", "display_name", "license_name", "license_url", "attribution_text", "review_dependencies_json", "expected_rows_json"],
  promotion_v4_expected_releases: ["release_id", "source_id", "release_content_sha256"],
  promotion_v4_expected_chunks: ["ordinal", "manifest_id", "sha256", "bytes", "statements", "rows_json"],
  promotion_v4_expected_tiles: ["tile_id", "manifest_id", "revision", "spot_count", "content_sha256", "schema_version", "part_count"],
  promotion_v4_expected_tile_parts: ["tile_id", "part_index", "spot_count", "content_sha256"],
  promotion_v4_chunk_sessions: ["id", "ordinal", "manifest_sha256", "sha256"],
  promotion_v4_applied_chunks: ["ordinal", "manifest_sha256", "sha256", "bytes", "statements", "rows_json"],
  promotion_v4_completions: ["id", "manifest_sha256"],
};
const DELETE_SESSION = "DELETE FROM promotion_v4_chunk_sessions WHERE id=1;";
export interface PromotionV4ImportPlan {
  version: "promotion-import-plan.v1";
  capacityPolicy: string;
  sourceManifestSha256: string;
  sourceManifestFile: { file: "manifest.json"; sha256: string; bytes: number };
  files: V4File[];
  wholePlanSha256: string;
}
export function importPlanDigest(plan: Omit<PromotionV4ImportPlan, "wholePlanSha256"> | PromotionV4ImportPlan): string {
  const { wholePlanSha256: _ignored, ...unsigned } = plan as PromotionV4ImportPlan;
  return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}
function controlInsert(table: string, values: unknown[]): string {
  const sql = `INSERT INTO ${table} (${controlColumns[table].join(", ")}) VALUES (${values.map(literal).join(", ")});`;
  if (Buffer.byteLength(sql + "\n") >= D1_CAPACITY_POLICY.statementBytes) throw Error("import plan control statement exceeds capacity policy");
  return sql;
}
function* initialization(source: PromotionV4Manifest): Generator<string> {
  yield controlInsert("promotion_v4_manifests", [1, source.wholeBundleSha256, source.capacityPolicy, source.chunks.length]);
  for (const s of source.sources) {
    yield controlInsert("promotion_v4_expected_sources", [s.sourceId, 1, s.releaseId, s.releaseContentSha256, s.observedOn, s.displayName, s.licenseName, s.licenseUrl, s.attributionText, JSON.stringify(s.reviewDependencies), JSON.stringify(s.rows)]);
    for (const r of s.additiveReleases ?? []) yield controlInsert("promotion_v4_expected_releases", [r.releaseId, s.sourceId, r.releaseContentSha256]);
  }
  for (const c of source.chunks) yield controlInsert("promotion_v4_expected_chunks", [c.ordinal, 1, c.sha256, c.bytes, c.statements, canonicalJson(c.rows)]);
  for (const t of source.tiles) {
    yield controlInsert("promotion_v4_expected_tiles", [t.tileId, 1, t.revision, t.spotCount, t.contentSha256, t.schemaVersion, t.parts.length]);
    for (const p of t.parts) yield controlInsert("promotion_v4_expected_tile_parts", [t.tileId, p.partIndex, p.spotCount, p.contentSha256]);
  }
}
function receipt(source: PromotionV4Manifest, ordinal: number): string {
  const c = source.chunks[ordinal - 1];
  return controlInsert("promotion_v4_applied_chunks", [ordinal, source.wholeBundleSha256, c.sha256, c.bytes, c.statements, canonicalJson(c.rows)]);
}
function planStatementTable(sql: string): string {
  if (sql === DELETE_SESSION) return "delete_session";
  const m = /^INSERT INTO (\w+) \(([\w, ]+)\) VALUES \((.*)\);$/s.exec(sql);
  if (m && Object.hasOwn(controlColumns, m[1])) {
    const tokens = m[3].match(/NULL|-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|'(?:[^']|'')*'/g) ?? [];
    if (m[2] !== controlColumns[m[1]].join(", ") || tokens.length !== controlColumns[m[1]].length || tokens.join(", ") !== m[3]) throw Error("import plan has invalid control SQL");
    return m[1];
  }
  return insertTable(sql);
}

export async function prepareV4ImportPlan(bundleDir: string, reviewedDigest: string, outputDir: string): Promise<PromotionV4ImportPlan> {
  const source = await verifyPromotionV4(bundleDir, reviewedDigest);
  let created = false;
  try {
    mkdirSync(outputDir); created = true;
    const sourceBytes = Buffer.from(JSON.stringify(source, null, 2) + "\n");
    writeFileSync(join(outputDir, "manifest.json"), sourceBytes, { flag: "wx" });
    const files: V4File[] = [];
    async function file(name: string, before: Iterable<string>, payload: V4File | undefined, after: Iterable<string>): Promise<void> {
      const fd = openSync(join(outputDir, name), "wx"), hash = createHash("sha256");
      let bytes = 0, statements = 0;
      function write(data: Buffer): void {
        bytes += data.length;
        if (bytes > D1_CAPACITY_POLICY.importBytes) throw Error("import plan file exceeds D1 import limit");
        writeSync(fd, data); hash.update(data);
      }
      function statement(sql: string): void {
        if (Buffer.byteLength(sql + "\n") >= D1_CAPACITY_POLICY.statementBytes) throw Error("import plan statement exceeds capacity policy");
        planStatementTable(sql); write(Buffer.from(sql + "\n")); statements++;
      }
      try {
        for (const sql of before) statement(sql);
        if (payload) {
          const payloadHash = createHash("sha256"); let payloadBytes = 0;
          // Exact bytes preserve the source digest stored by the matching receipt.
          for await (const data of createReadStream(join(bundleDir, payload.file), { highWaterMark: 16_384 })) {
            const buffer = data as Buffer; payloadBytes += buffer.length; payloadHash.update(buffer); write(buffer);
          }
          if (payloadBytes !== payload.bytes || payloadHash.digest("hex") !== payload.sha256) throw Error("source payload changed while preparing import plan");
          // Separate the copied payload from its receipt even if its last statement lacks a newline.
          write(Buffer.from("\n")); statements += payload.statements;
        }
        for (const sql of after) statement(sql);
      } finally { closeSync(fd); }
      files.push({ file: name, sha256: hash.digest("hex"), bytes, statements });
    }
    await file("initialize.sql", initialization(source), undefined, []);
    for (const c of source.chunks) await file(c.file,
      c.ordinal === 1 ? [controlInsert("promotion_v4_chunk_sessions", [1, 1, reviewedDigest, c.sha256])] : [], c,
      [...(c.ordinal === 1 ? [DELETE_SESSION] : []), receipt(source, c.ordinal)]);
    await file("finalize.sql", [], source.finalize, [controlInsert("promotion_v4_completions", [1, reviewedDigest])]);
    const unsigned = { version: "promotion-import-plan.v1" as const, capacityPolicy: source.capacityPolicy, sourceManifestSha256: reviewedDigest,
      sourceManifestFile: { file: "manifest.json" as const, sha256: createHash("sha256").update(sourceBytes).digest("hex"), bytes: sourceBytes.length }, files };
    const plan: PromotionV4ImportPlan = { ...unsigned, wholePlanSha256: importPlanDigest(unsigned) };
    const json = JSON.stringify(plan, null, 2) + "\n";
    if (Buffer.byteLength(json) > D1_CAPACITY_POLICY.maxManifestBytes) throw Error("import plan manifest exceeds capacity policy");
    writeFileSync(join(outputDir, "plan-manifest.json"), json, { flag: "wx" });
    return plan;
  } catch (error) { if (created) rmSync(outputDir, { recursive: true, force: true }); throw error; }
}

export async function verifyV4ImportPlan(directory: string, expectedPlanDigest: string, expectedSourceDigest: string): Promise<PromotionV4ImportPlan> {
  const sha = /^[a-f0-9]{64}$/;
  if (!sha.test(expectedPlanDigest) || !sha.test(expectedSourceDigest)) throw Error("import plan reviewed digests must be SHA-256");
  const manifestPath = join(directory, "plan-manifest.json"), info = await lstat(manifestPath);
  if (!info.isFile() || info.size > D1_CAPACITY_POLICY.maxManifestBytes) throw Error("invalid import plan manifest file");
  const plan = JSON.parse(await readFile(manifestPath, "utf8")) as PromotionV4ImportPlan;
  if (plan.version !== "promotion-import-plan.v1" || plan.capacityPolicy !== D1_CAPACITY_POLICY.version || plan.sourceManifestSha256 !== expectedSourceDigest || plan.wholePlanSha256 !== expectedPlanDigest || importPlanDigest(plan) !== expectedPlanDigest || !Array.isArray(plan.files)) throw Error("import plan manifest/digest/version mismatch");
  const source = await readV4Manifest(directory, expectedSourceDigest);
  const expectedFiles = ["initialize.sql", ...source.chunks.map(c => c.file), "finalize.sql"];
  if (plan.files.length !== expectedFiles.length || plan.sourceManifestFile.file !== "manifest.json" || !sha.test(plan.sourceManifestFile.sha256) || !Number.isSafeInteger(plan.sourceManifestFile.bytes) || plan.sourceManifestFile.bytes <= 0 || plan.sourceManifestFile.bytes > D1_CAPACITY_POLICY.maxManifestBytes) throw Error("invalid import plan source declaration");
  const sourceHash = createHash("sha256"); let sourceBytes = 0;
  for await (const bytes of createReadStream(join(directory, "manifest.json"), { highWaterMark: 16_384 })) { sourceHash.update(bytes); sourceBytes += (bytes as Buffer).length; }
  if (sourceBytes !== plan.sourceManifestFile.bytes || sourceHash.digest("hex") !== plan.sourceManifestFile.sha256) throw Error("import plan source manifest file mismatch");
  for (const [index, file] of plan.files.entries()) {
    if (file.file !== expectedFiles[index] || !sha.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > D1_CAPACITY_POLICY.importBytes || !Number.isSafeInteger(file.statements) || file.statements <= 0) throw Error("invalid import plan file declaration");
    const path = join(directory, file.file), stat = await lstat(path);
    if (!stat.isFile() || stat.size !== file.bytes) throw Error("import plan file is missing or has wrong size");
    const hash = createHash("sha256"); let bytes = 0, statements = 0;
    const payload = index === 0 ? undefined : index === plan.files.length - 1 ? source.finalize : source.chunks[index - 1];
    const prefixBytes = index === 1 ? Buffer.byteLength(controlInsert("promotion_v4_chunk_sessions", [1, 1, expectedSourceDigest, source.chunks[0].sha256]) + "\n") : 0;
    const payloadHash = createHash("sha256");
    const expectedControls = index === 0 ? [] : index === plan.files.length - 1 ? [controlInsert("promotion_v4_completions", [1, expectedSourceDigest])] : [
      ...(index === 1 ? [controlInsert("promotion_v4_chunk_sessions", [1, 1, expectedSourceDigest, source.chunks[0].sha256]), DELETE_SESSION] : []), receipt(source, index)];
    if (payload && (file.bytes !== payload.bytes + 1 + expectedControls.reduce((n, sql) => n + Buffer.byteLength(sql + "\n"), 0) || file.statements !== payload.statements + expectedControls.length)) throw Error("import plan payload declaration differs from source");
    const controls: string[] = []; // Only fixed wrappers, not payload statements.
    const init = index === 0 ? initialization(source) : undefined;
    for await (const sql of sqlStatements(path, data => {
      hash.update(data);
      if (payload) {
        const start = Math.max(0, prefixBytes - bytes), end = Math.min(data.length, prefixBytes + payload.bytes - bytes);
        if (end > start) payloadHash.update(data.subarray(start, end));
      }
      bytes += data.length;
    })) {
      const table = planStatementTable(sql); statements++;
      if (init) { if (sql !== init.next().value) throw Error("import plan initialization differs from reviewed source"); }
      else if (Object.hasOwn(controlColumns, table) || table === "delete_session") {
        controls.push(sql); if (controls.length > 3) throw Error("import plan has unexpected control statements");
      } else if (index === plan.files.length - 1 && table !== "promotion_multi_bootstrap_completions") throw Error("import plan final file contains unexpected payload");
    }
    if (init && !init.next().done) throw Error("import plan initialization is incomplete");
    if (!init) {
      if (canonicalJson(controls) !== canonicalJson(expectedControls)) throw Error("import plan receipt/session differs from reviewed source");
    }
    if (payload && payloadHash.digest("hex") !== payload.sha256) throw Error("import plan copied payload hash differs from source");
    if (bytes !== file.bytes || statements !== file.statements || hash.digest("hex") !== file.sha256) throw Error("import plan file hash/count mismatch");
  }
  return plan;
}
