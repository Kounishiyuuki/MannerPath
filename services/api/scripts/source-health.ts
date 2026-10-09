// Explicit live, read-only audit. Only reviewed official resource URLs are requested.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync, crc32 } from "node:zlib";
import { pathToFileURL, URL } from "node:url";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { checkSourceHealth, type HealthTarget } from "../src/source-health/check.ts";
import { buildReport, jstDate, renderSummary, validateReviews, type SourceReview } from "../src/source-health/evaluate.ts";
import { ecdheAeadFetch } from "./source-health-transport.ts";
import { TAITO_ORIGINAL_DATA_URL } from "../src/pipeline/taito.ts";
import { OSAKA_DATA_URL } from "../src/pipeline/osaka-adapter.ts";
import { KOTO_DATA_URL } from "../src/pipeline/koto-adapter.ts";
import { MUSASHINO_DATA_URL } from "../src/pipeline/musashino-adapter.ts";
import { MINATO_DATA_URL } from "../src/pipeline/minato-adapter.ts";
import { KYOTO_DATA_URL } from "../src/pipeline/kyoto-adapter.ts";
const root = new URL("../../../services/data-pipeline/fixtures/", import.meta.url);
const resources: Record<string, { filename: string; url: string }> = {
  "taito-public-smoking-areas": { filename: "20260818_koshukitsuenjo.csv", url: TAITO_ORIGINAL_DATA_URL },
  "osaka-designated-smoking-areas": { filename: "opendata_1012.csv", url: OSAKA_DATA_URL },
  "koto-station-smoking-areas": { filename: "131083_237_public_smoking_area_station.csv", url: KOTO_DATA_URL },
  "musashino-public-smoking-areas": { filename: "doc.kml", url: MUSASHINO_DATA_URL },
  "minato-designated-smoking-areas": { filename: "minatokushisetsujoho_fukugo.csv", url: MINATO_DATA_URL },
  "kyoto-public-smoking-places": { filename: "20260903_shisetsu.csv", url: KYOTO_DATA_URL },
};
// Read ZIP central directory rather than trusting local headers/data descriptors. No files are written.
export function archiveMember(bytes: Uint8Array, suffix: string): Uint8Array {
  const buffer = Buffer.from(bytes); const limit = 5_000_000;
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error("unsupported ZIP");
  const count = buffer.readUInt16LE(end + 10); let position = buffer.readUInt32LE(end + 16);
  const matches: Uint8Array[] = [];
  if (count > 100) throw new Error("archive member limit");
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(position) !== 0x02014b50) throw new Error("invalid central directory");
    const flags = buffer.readUInt16LE(position + 8), method = buffer.readUInt16LE(position + 10);
    const compressed = buffer.readUInt32LE(position + 20), expanded = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28), extra = buffer.readUInt16LE(position + 30), comment = buffer.readUInt16LE(position + 32);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString("latin1");
    if (name.endsWith(suffix)) {
      if (matches.length !== 0) throw new Error("duplicate archive member");
      if (flags & 1 || expanded > limit || compressed > limit) throw new Error("unsafe archive member");
      const local = buffer.readUInt32LE(position + 42);
      if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 8) !== method || buffer.readUInt16LE(local + 6) !== flags) throw new Error("invalid local header");
      const localNameLength = buffer.readUInt16LE(local + 26);
      if (!buffer.subarray(local + 30, local + 30 + localNameLength).equals(buffer.subarray(position + 46, position + 46 + nameLength))) throw new Error("local name mismatch");
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      if (start + compressed > buffer.length) throw new Error("truncated ZIP");
      const data = buffer.subarray(start, start + compressed);
      const output = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: limit }) : null;
      if (!output || output.length !== expanded || crc32(output) !== buffer.readUInt32LE(position + 16)) throw new Error("unsupported or invalid archive member");
      matches.push(output);
    }
    position += 46 + nameLength + extra + comment;
  }
  if (matches.length !== 1) throw new Error("expected exactly one archive member");
  return matches[0];
}
export function productionHealthTargets(): HealthTarget[] {
  return SOURCE_ADAPTERS.map(adapter => {
    const resource = resources[adapter.registry.sourceId];
    if (!resource) throw new Error("Reviewed source needs explicit health inventory");
    const directory = new URL(`${adapter.registry.sourceId}/`, root);
    const fixture = new Uint8Array(readFileSync(new URL(resource.filename, directory)));
    const target: HealthTarget = { adapter, url: resource.url,
      baselineSha256: createHash("sha256").update(fixture).digest("hex"), baselineHeader: adapter.parse(fixture).header,
      mimeTypes: ["text/csv", "application/csv", "application/octet-stream", "application/vnd.ms-excel", "text/plain", "text/comma-separated-values"] };
    if (adapter.registry.sourceId === "musashino-public-smoking-areas") {
      target.baselineResourceSha256 = JSON.parse(readFileSync(new URL("fetch.json", directory), "utf8")).archiveSha256;
      target.mimeTypes = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];
      target.prepare = bytes => archiveMember(archiveMember(bytes, ".kmz"), "doc.kml");
    }
    if (adapter.registry.sourceId === "kyoto-public-smoking-places") {
      target.mimeTypes = [...target.mimeTypes, "application/force-download"];
      target.request = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ upload_file: "20260903182354_data（令和8年9月3日現在）.csv", download: "このデータをダウンロード" }).toString() };
    }
    return target;
  }).sort((a, b) => a.adapter.registry.sourceId.localeCompare(b.adapter.registry.sourceId));
}
// Osaka's server prefers 1024-bit DHE; see source-health-transport.ts. Others keep Node's default fetch.
const transports: Record<string, { name: string; fetch: (url: string, init?: RequestInit) => Promise<Response> }> = {
  "osaka-designated-smoking-areas": { name: "node-https-ecdhe-aead", fetch: ecdheAeadFetch },
};
export function sourceReviews(): SourceReview[] {
  return JSON.parse(readFileSync(new URL("../../data-pipeline/source-health/review-metadata.json", import.meta.url), "utf8")).sources;
}
export async function main(args = process.argv.slice(2), now = new Date()) {
  if (args.some(arg => arg !== "--live" && !arg.startsWith("--source=")) || !args.includes("--live")) throw new Error("Usage: npm run source:health -- --live [--source=source-id]");
  const ids = args.filter(arg => arg.startsWith("--source=")).map(arg => arg.slice(9));
  const targets = productionHealthTargets();
  if (ids.some(id => !targets.some(t => t.adapter.registry.sourceId === id))) throw new Error("Unknown reviewed source id");
  const reviews = sourceReviews();
  validateReviews(reviews, targets.map(t => t.adapter.registry.sourceId));
  // Sequential and exhaustive: every source is checked and reported even when another fails.
  const results = [];
  for (const target of targets.filter(t => !ids.length || ids.includes(t.adapter.registry.sourceId))) {
    const transport = transports[target.adapter.registry.sourceId] ?? { name: "node-fetch", fetch };
    results.push({ ...await checkSourceHealth(target, { fetch: transport.fetch }), transport: transport.name });
  }
  const report = buildReport(results, reviews, jstDate(now));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.stderr.write(renderSummary(report));
  process.exitCode = report.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 2; });
