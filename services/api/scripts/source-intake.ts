// Offline advisory preparation: receipt claims never approve publication.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { inspectPayload } from "../../data-pipeline/discovery/scanner.mjs";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { parseCsv } from "../src/pipeline/csv.ts";
import { observeSourceRecord, type SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { candidateSchema, evaluateCandidate } from "./source-onboarding.ts";
export type IntakeFormat = "csv" | "json" | "pdf" | "map";
const text = z.string().trim().min(1).max(4000);
const url = z.url().max(4000).refine(value => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
});
export const receiptSchema = z.object({
  version: z.literal(1), sourceId: z.string().max(100).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  publisher: text, publisherUrl: url, resourceUrl: url.nullable().default(null), receivedOn: z.iso.date(),
  evidenceReference: text.nullable().default(null), rightsReference: text.nullable().default(null),
  attributionText: text.nullable().default(null), licenseName: text.nullable().default(null),
  licenseUrl: url.nullable().default(null),
  coordinateMeaning: z.enum(["unknown", "smokingPlace", "facility", "namedZone"]).default("unknown"),
  operationClaim: z.enum(["unknown", "active", "closed", "relocated"]).default("unknown"),
  operationEvidenceReference: text.nullable().default(null),
}).strict();
export type IntakeReceipt = z.output<typeof receiptSchema>;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_METADATA_BYTES = 64 * 1024;
export const MAX_JSON_DEPTH = 128;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function utf8(bytes: Uint8Array) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Input must be valid UTF-8"); }
}
// Syntax is checked by JSON.parse; token traversal additionally rejects duplicate keys.
export function parseStrictJson(text: string): unknown {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Malformed JSON input"); }
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
  let index = 0;
  function walk(depth = 0): void {
    if (depth > MAX_JSON_DEPTH) throw new Error("JSON nesting exceeds local inspection limit");
    const token = tokens[index++];
    if (token === "{") {
      const keys = new Set<string>();
      if (tokens[index] !== "}") do {
        const key = JSON.parse(tokens[index++]) as string;
        if (keys.has(key)) throw new Error("Duplicate JSON key");
        keys.add(key); index++; walk(depth + 1);
      } while (tokens[index++] === ",");
      else index++;
    } else if (token === "[") {
      if (tokens[index] !== "]") do { walk(depth + 1); } while (tokens[index++] === ",");
      else index++;
    }
  }
  walk(); return value;
}
function jsonShape(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("JSON records must be objects");
  const object = value as Record<string, unknown>;
  const rows = Array.isArray(value) ? value : object.type === "FeatureCollection" ? object.features :
    object.records ?? object.data ?? object.features ?? [value];
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("JSON records must be an array of objects");
  }
  const header = [...new Set(rows.flatMap(row => Object.keys(row)))].sort();
  return { header, rawRowCount: rows.length,
    missingFieldCount: header.length * rows.length - rows.reduce((count, row) => count + Object.keys(row).length, 0),
    nullFieldCount: rows.reduce((count, row) => count + Object.values(row).filter(value => value === null).length, 0),
    identicalRowCount: rows.length - new Set(rows.map(row => JSON.stringify(row))).size };
}
export function inspectReceivedFile(bytes: Uint8Array, format: IntakeFormat, receipt: IntakeReceipt) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error("Input file size is outside limits");
  if (!["csv", "json", "pdf", "map"].includes(format)) throw new Error("Unsupported declared format");
  const base = { sha256: hash(bytes), format, encoding: null as string | null,
    header: [] as string[], rawRowCount: null as number | null };
  if (format === "pdf" || format === "map") return { ...base, scanner: null, reviewHints: ["MANUAL_EVIDENCE_REVIEW"] };
  const decoded = utf8(bytes);
  let shape: { header: string[]; rawRowCount: number; missingFieldCount: number; nullFieldCount: number; identicalRowCount: number };
  if (format === "csv") {
    let parsed: ReturnType<typeof parseCsv>;
    try { parsed = parseCsv(decoded); } catch { throw new Error("Malformed CSV input"); }
    if (parsed.header.some(column => !column.trim()) || new Set(parsed.header).size !== parsed.header.length) {
      throw new Error("Empty or duplicate CSV header");
    }
    shape = { header: parsed.header, rawRowCount: parsed.rows.length,
      missingFieldCount: parsed.rows.reduce((count, row) => count + row.filter(value => !value.trim()).length, 0), nullFieldCount: 0,
      identicalRowCount: parsed.rows.length - new Set(parsed.rows.map(row => JSON.stringify(row))).size };
  } else shape = jsonShape(parseStrictJson(decoded));
  const advisory = inspectPayload(Buffer.from(bytes), { url: receipt.resourceUrl ?? "",
    format, contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8" });
  return { ...base, ...shape, encoding: "utf-8", scanner: { reviewStatus: "UNREVIEWED",
    matchingRowCount: advisory.matchingRowCount, coordinateAvailability: advisory.coordinateAvailability,
    blockerCodes: advisory.blockerCodes }, reviewHints: ["SCANNER_SIGNALS_REQUIRE_HUMAN_REVIEW",
      ...(shape.missingFieldCount || shape.nullFieldCount ? ["MISSING_OR_NULL_FIELDS_REMAIN_UNKNOWN", "PARTIAL_FIELDS_REVIEW_REQUIRED"] : []),
      ...(shape.identicalRowCount ? ["IDENTICAL_ROWS_REVIEW_REQUIRED"] : [])] };
}
function preview(bytes: Uint8Array, adapter: SourceAdapter, receipt: IntakeReceipt) {
  try {
    const parsed = adapter.parse(bytes);
    const observations = parsed.rows.filter(row => !adapter.includesRecord || adapter.includesRecord(row)).map(row => {
      const observation = observeSourceRecord(adapter, row);
      if (["facility", "namedZone"].includes(receipt.coordinateMeaning) && !observation.locationAnchorId) throw new Error();
      return { upstreamRowRef: adapter.upstreamRowRef(row), rowSha256: hash(JSON.stringify(row)), observation };
    });
    return { sourceId: receipt.sourceId, mappingVersion: adapter.mappingVersion, reviewStatus: "UNREVIEWED", observations };
  } catch { throw new Error("Adapter preview failed; review file shape and coordinate meaning"); }
}
export function prepareIntake(input: { metadata: unknown; bytes: Uint8Array; format: IntakeFormat;
  previousBytes?: Uint8Array; adapter?: SourceAdapter }) {
  const parsed = receiptSchema.safeParse(input.metadata);
  if (!parsed.success) throw new Error("Invalid receipt metadata; check required fields and declared schema");
  const receipt = parsed.data;
  const inspection = inspectReceivedFile(input.bytes, input.format, receipt);
  if (input.adapter && input.adapter.registry.sourceId !== receipt.sourceId) throw new Error("Adapter must match receipt sourceId");
  if (input.adapter && !["csv", "json"].includes(input.format)) throw new Error("PDF and map files require manual evidence review");
  const adapterPreview = input.adapter ? preview(input.bytes, input.adapter, receipt) : null;
  const reviewHints = [...inspection.reviewHints];
  if (["closed", "relocated"].includes(receipt.operationClaim)) reviewHints.push("OPERATION_CHANGE_REVIEW_REQUIRED");
  if (adapterPreview) {
    const refs = adapterPreview.observations.map(row => row.upstreamRowRef).filter(ref => ref !== null);
    const hashes = adapterPreview.observations.map(row => row.rowSha256);
    const points = adapterPreview.observations.map(row => `${row.observation.latitude},${row.observation.longitude}`);
    if (new Set(refs).size !== refs.length) reviewHints.push("DUPLICATE_UPSTREAM_REFERENCES_REVIEW_REQUIRED");
    if (new Set(hashes).size !== hashes.length) reviewHints.push("IDENTICAL_ROWS_REVIEW_REQUIRED");
    if (new Set(points).size !== points.length) reviewHints.push("SHARED_COORDINATES_REVIEW_REQUIRED");
  }
  let diff: { status: string; changes: string[]; missingRowsMeaning: string;
    rowHints: { kind: string; upstreamRowRef: string; relocationReviewRequired: boolean }[] } | null = null;
  if (input.previousBytes) {
    const previous = inspectReceivedFile(input.previousBytes, input.format, receipt);
    const changes = inspection.sha256 === previous.sha256 ? [] : ["fileSha256"];
    if (JSON.stringify(inspection.header) !== JSON.stringify(previous.header)) changes.push("header");
    if (inspection.rawRowCount !== previous.rawRowCount) changes.push("rawRowCount");
    const rowHints: NonNullable<typeof diff>["rowHints"] = [];
    if (input.adapter && adapterPreview) {
      const old = preview(input.previousBytes, input.adapter, receipt).observations;
      const oldByRef = new Map<string, typeof old>();
      const currentCounts = new Map<string, number>();
      for (const row of old) if (row.upstreamRowRef !== null) {
        const rows = oldByRef.get(row.upstreamRowRef) ?? [];
        rows.push(row); oldByRef.set(row.upstreamRowRef, rows);
      }
      for (const row of adapterPreview.observations) if (row.upstreamRowRef !== null) {
        currentCounts.set(row.upstreamRowRef, (currentCounts.get(row.upstreamRowRef) ?? 0) + 1);
      }
      for (const row of adapterPreview.observations) {
        if (row.upstreamRowRef === null) continue;
        const prior = oldByRef.get(row.upstreamRowRef) ?? [];
        if (prior.length !== 1 || currentCounts.get(row.upstreamRowRef) !== 1) continue;
        if (prior[0].rowSha256 !== row.rowSha256) rowHints.push({ kind: "CHANGED", upstreamRowRef: row.upstreamRowRef,
          relocationReviewRequired: prior[0].observation.latitude !== row.observation.latitude ||
            prior[0].observation.longitude !== row.observation.longitude || prior[0].observation.locationAnchorId !== row.observation.locationAnchorId });
      }
    }
    if (rowHints.some(row => row.relocationReviewRequired)) reviewHints.push("RELOCATION_REVIEW_REQUIRED");
    diff = { status: changes.length ? "changed" : "unchanged", changes, missingRowsMeaning: "unknown", rowHints };
    reviewHints.push("MISSING_ROWS_NEVER_IMPLY_CLOSURE");
  }
  const candidate = candidateSchema.parse({ sourceId: receipt.sourceId, resource: {
    rawUrl: receipt.resourceUrl, publisher: receipt.publisher, licenseMetadata: receipt.licenseName,
    attributionMetadata: receipt.attributionText, matchingRowCount: inspection.scanner?.matchingRowCount ?? null,
    blockerCodes: inspection.scanner?.blockerCodes ?? [],
  } });
  return { version: 1, publicationStatus: "blocked", approvalAutomated: false, productionApproval: false,
    humanReviewRequired: true, receipt: { ...receipt, reviewStatus: "UNREVIEWED" }, inspection,
    onboarding: evaluateCandidate(candidate), adapterPreview, diff, reviewHints,
    scope: "Offline advisory receipt only; no import, deduplication, entity matching, lifecycle update or approval." };
}
function readRegularFile(path: string, limit: number) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) throw new Error();
    const bytes = readFileSync(path);
    if (bytes.length > limit) throw new Error();
    return bytes;
  } catch { throw new Error("Cannot read a regular input file within size limits"); }
}
export function run(args: string[]) {
  const options = new Map<string, string>();
  const allowed = ["--metadata", "--file", "--format", "--adapter", "--previous", "--out"];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || options.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid or duplicate CLI arguments");
    options.set(args[i], args[i + 1]);
  }
  if (!["--metadata", "--file", "--format"].every(key => options.has(key))) throw new Error("Required: --metadata --file --format");
  const format = options.get("--format")!;
  if (!["csv", "json", "pdf", "map"].includes(format)) throw new Error("Unsupported declared format");
  const adapterId = options.get("--adapter");
  const adapter = adapterId ? SOURCE_ADAPTERS.find(item => item.registry.sourceId === adapterId) : undefined;
  if (adapterId && !adapter) throw new Error("Unknown reviewed adapter");
  const metadata = parseStrictJson(utf8(readRegularFile(options.get("--metadata")!, MAX_METADATA_BYTES)));
  const report = prepareIntake({ metadata, bytes: readRegularFile(options.get("--file")!, MAX_FILE_BYTES),
    format: format as IntakeFormat, adapter,
    previousBytes: options.has("--previous") ? readRegularFile(options.get("--previous")!, MAX_FILE_BYTES) : undefined });
  const json = JSON.stringify(report, null, 2) + "\n";
  if (options.has("--out")) {
    try {
      const target = resolve(options.get("--out")!);
      for (let parent = dirname(target); parent !== dirname(parent); parent = dirname(parent)) {
        // macOS system aliases are expected; user-created symlink ancestors are refused.
        if (lstatSync(parent).isSymbolicLink() && !["/tmp", "/var"].includes(parent)) throw new Error();
      }
      writeFileSync(target, json, { flag: "wx" });
    }
    catch { throw new Error("Cannot create output; choose a fresh writable file path"); }
  } else console.log(json);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { run(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Intake preparation failed"); process.exitCode = 1; }
}
