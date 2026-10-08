import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ADDITIVE_TABLES } from "../src/pipeline/promotion.ts";
import { canonicalJson, canonicalManifestDigest, D1_CAPACITY_POLICY, type PromotionV4Manifest, type V4File } from "./promotion-v4-format.ts";

import { iterateV4Tiles, tileDeclarationSchema, tileDeclarationsSchema, validateTileMetadataManifest } from "./promotion-v4-metadata.ts";

const SHA = /^[a-f0-9]{64}$/;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = integer.min(1);
const digestSchema = z.string().regex(SHA);
const countsSchema = z.record(z.string(), integer);
const fileSchema = z.object({ file: z.string(), sha256: digestSchema, bytes: positive, statements: positive }).strict();
const manifestSchema = z.object({
  bundleVersion: z.literal("promotion-bundle.v4"), capacityPolicy: z.string(), chunkTargetBytes: positive,
  sources: z.array(z.object({
    sourceId: z.string().min(1), releaseId: positive, observedOn: z.string().nullable(), releaseContentSha256: digestSchema,
    displayName: z.string(), licenseName: z.string().nullable(), licenseUrl: z.string().nullable(), attributionText: z.string(),
    rows: countsSchema,
    reviewDependencies: z.array(z.object({ recordId: positive, previousReleaseId: positive, previousReleaseContentSha256: digestSchema }).strict()),
    additiveReleases: z.array(z.object({ releaseId: positive, releaseContentSha256: digestSchema }).strict()).optional(),
  }).strict()).min(1),
  rows: countsSchema,
  tiles: z.array(tileDeclarationSchema),
  tileDeclarations: tileDeclarationsSchema.optional(),
  chunks: z.array(fileSchema.extend({ ordinal: positive, rows: countsSchema })).min(1),
  finalize: fileSchema, wholeBundleSha256: digestSchema,
}).strict();
const declarationColumns: Record<string, string[]> = {
  promotion_multi_bootstraps: ["promotion_bootstrap_id", "bundle_version", "source_count", "expected_rows_json"],
  promotion_multi_bootstrap_sources: ["source_id", "promotion_bootstrap_id", "release_id", "release_content_sha256", "display_name", "license_name", "license_url", "attribution_text", "review_dependencies_json", "expected_rows_json"],
  promotion_multi_bootstrap_additive_releases: ["release_id", "source_id", "release_content_sha256"],
  promotion_multi_bootstrap_completions: ["promotion_bootstrap_id"],
};
const columns = new Map([...ADDITIVE_TABLES.map(s => [s.table, s.columns] as const), ...Object.entries(declarationColumns)]);
const tableOrder = ["promotion_multi_bootstraps", "promotion_multi_bootstrap_sources", "promotion_multi_bootstrap_additive_releases", ...ADDITIVE_TABLES.map(s => s.table)];

/** Restricted generated SQL grammar: literals only, no expressions, comments, functions or private tables. */
export function insertTable(statement: string): string {
  const match = /^INSERT INTO (\w+) \(([\w, ]+)\) VALUES \((.*)\);$/s.exec(statement.trim());
  if (!match || match[2] !== columns.get(match[1])?.join(", ")) throw new Error("v4: unexpected SQL shape/table/columns");
  const tokens = match[3].match(/NULL|-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|'(?:[^']|'')*'/g) ?? [];
  if (tokens.length !== columns.get(match[1])!.length || tokens.join(", ") !== match[3]) throw new Error("v4: only canonical SQL literals are allowed");
  return match[1];
}

/** Holds at most one budgeted statement. Semicolons/newlines inside SQL string literals are data. */
export async function* sqlStatements(path: string, onBytes?: (bytes: Buffer) => void): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "", quoted = false, quotePending = false, statementBytes = 0;
  for await (const bytes of createReadStream(path, { highWaterMark: 16_384 })) {
    onBytes?.(bytes as Buffer);
    const text = decoder.decode(bytes as Buffer, { stream: true });
    for (const ch of text) {
      if (quotePending) {
        quotePending = false;
        if (ch === "'") { pending += ch; statementBytes++; continue; }
        quoted = false;
      }
      if (ch === "'") { if (quoted) quotePending = true; else quoted = true; }
      pending += ch;
      statementBytes += Buffer.byteLength(ch);
      if (statementBytes >= D1_CAPACITY_POLICY.statementBytes) throw new Error("v4: SQL statement exceeds capacity policy");
      if (ch === ";" && !quoted) {
        yield pending.trim(); pending = ""; statementBytes = 0;
      } else if (!quoted && pending.trim() === "") { pending = ""; statementBytes = 0; }
    }
  }
  decoder.decode();
  if (pending.trim() !== "" || quoted && !quotePending) throw new Error("v4: incomplete SQL statement");
}

async function regularFile(path: string, maxBytes: number): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error("v4: invalid or oversized artifact file");
}
export async function readV4Manifest(directory: string, expectedDigest: string): Promise<PromotionV4Manifest> {
  if (!SHA.test(expectedDigest)) throw new Error("v4: independently reviewed digest is required");
  const path = join(directory, "manifest.json");
  await regularFile(path, D1_CAPACITY_POLICY.maxManifestBytes);
  const manifest: PromotionV4Manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (manifest.bundleVersion !== "promotion-bundle.v4" || manifest.capacityPolicy !== D1_CAPACITY_POLICY.version
    || manifest.wholeBundleSha256 !== expectedDigest || canonicalManifestDigest(manifest) !== expectedDigest
    || !Number.isSafeInteger(manifest.chunkTargetBytes) || manifest.chunkTargetBytes < D1_CAPACITY_POLICY.statementBytes
    || manifest.chunkTargetBytes >= D1_CAPACITY_POLICY.importBytes
    || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0
    || !Array.isArray(manifest.sources) || manifest.sources.length === 0 || !Array.isArray(manifest.tiles)) {
    throw new Error("v4: stale/wrong manifest or capacity policy");
  }
  if (new Set(manifest.sources.map(s => s.sourceId)).size !== manifest.sources.length) throw new Error("v4: duplicate source declaration");
  validateTileMetadataManifest(manifest);
  for (const counts of [manifest.rows, ...manifest.sources.map(s => s.rows), ...manifest.chunks.map(c => c.rows)]) {
    if (!counts || Object.entries(counts).some(([table, n]) => !columns.has(table) || !Number.isSafeInteger(n) || n < 0)) throw new Error("v4: invalid row counts");
  }
  for (const [index, chunk] of manifest.chunks.entries()) {
    if (chunk.ordinal !== index + 1 || chunk.file !== `chunk-${String(index + 1).padStart(4, "0")}.sql`) throw new Error("v4: chunk ordering/path mismatch");
    if (chunk.bytes > manifest.chunkTargetBytes) throw new Error("v4: chunk exceeds declared operational byte budget");
  }
  if (manifest.finalize.file !== "finalize.sql") throw new Error("v4: finalize path mismatch");
  return manifest;
}
export async function verifyV4File(directory: string, file: V4File, onStatement?: (sql: string, table: string) => void): Promise<{ rows: Record<string, number>; maxStatementBytes: number }> {
  if (!SHA.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes >= D1_CAPACITY_POLICY.importBytes
    || !Number.isSafeInteger(file.statements) || file.statements < 1) throw new Error("v4: invalid file declaration");
  await regularFile(join(directory, file.file), file.bytes);
  const hash = createHash("sha256"); let bytes = 0, statements = 0, maxStatementBytes = 0;
  const rows: Record<string, number> = {};
  for await (const sql of sqlStatements(join(directory, file.file), b => { hash.update(b); bytes += b.length; })) {
    const table = insertTable(sql);
    rows[table] = (rows[table] ?? 0) + 1;
    statements++; maxStatementBytes = Math.max(maxStatementBytes, Buffer.byteLength(sql));
    onStatement?.(sql, table);
  }
  if (bytes !== file.bytes || statements !== file.statements || hash.digest("hex") !== file.sha256) throw new Error("v4: corrupted chunk digest/size/statements");
  return { rows, maxStatementBytes };
}
export async function verifyPromotionV4(directory: string, expectedDigest: string): Promise<PromotionV4Manifest> {
  const manifest = await readV4Manifest(directory, expectedDigest);
  for await (const _tile of iterateV4Tiles(directory, manifest)) { /* verify before any mutation */ }
  const totals: Record<string, number> = {}; let order = -1;
  for (const chunk of manifest.chunks) {
    const verified = await verifyV4File(directory, chunk, (_sql, table) => {
      const rank = tableOrder.indexOf(table);
      if (rank < order || rank === -1) throw new Error("v4: statement ordering mismatch");
      order = rank;
    });
    if (canonicalJson(verified.rows) !== canonicalJson(chunk.rows)) throw new Error("v4: declared chunk row counts mismatch");
    for (const [table, count] of Object.entries(verified.rows)) totals[table] = (totals[table] ?? 0) + count;
  }
  for (const [table, count] of Object.entries(manifest.rows)) if ((totals[table] ?? 0) !== count) throw new Error(`v4: final count mismatch: ${table}`);
  for (const table of ADDITIVE_TABLES.map(s => s.table)) if ((totals[table] ?? 0) !== (manifest.rows[table] ?? 0)) throw new Error(`v4: undeclared table rows: ${table}`);
  if (totals.promotion_multi_bootstraps !== 1 || totals.promotion_multi_bootstrap_sources !== manifest.sources.length) throw new Error("v4: declaration count mismatch");
  const finalized = await verifyV4File(directory, manifest.finalize, (sql, table) => {
    if (table !== "promotion_multi_bootstrap_completions" || sql !== "INSERT INTO promotion_multi_bootstrap_completions (promotion_bootstrap_id) VALUES (1);") throw new Error("v4: invalid finalize SQL");
  });
  if (finalized.rows.promotion_multi_bootstrap_completions !== 1) throw new Error("v4: invalid finalize count");
  return manifest;
}
