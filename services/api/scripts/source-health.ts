// Explicit live, read-only audit. Only reviewed official resource URLs are requested.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync, crc32 } from "node:zlib";
import { pathToFileURL, URL } from "node:url";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { checkSourceHealth, type HealthTarget } from "../src/source-health/check.ts";
import { buildReport, jstDate, renderSummary, validateReviews, type SourceReview } from "../src/source-health/evaluate.ts";
import { checkRights, notChecked, withRights } from "../src/source-health/rights.ts";
import { ecdheAeadFetch } from "./source-health-transport.ts";
import { TAITO_ORIGINAL_DATA_URL } from "../src/pipeline/taito.ts";
import { OSAKA_DATA_URL } from "../src/pipeline/osaka-adapter.ts";
import { KOTO_DATA_URL } from "../src/pipeline/koto-adapter.ts";
import { MUSASHINO_DATA_URL } from "../src/pipeline/musashino-adapter.ts";
import { MINATO_DATA_URL } from "../src/pipeline/minato-adapter.ts";
import { KYOTO_DATA_URL } from "../src/pipeline/kyoto-adapter.ts";
import { KOMATSU_AIRPORT_PAGE_URL } from "../src/pipeline/komatsu-airport-adapter.ts";
const root = new URL("../../../services/data-pipeline/fixtures/", import.meta.url);
const resources: Record<string, { filename: string; url: string }> = {
  "taito-public-smoking-areas": { filename: "20260818_koshukitsuenjo.csv", url: TAITO_ORIGINAL_DATA_URL },
  "osaka-designated-smoking-areas": { filename: "opendata_1012.csv", url: OSAKA_DATA_URL },
  "koto-station-smoking-areas": { filename: "131083_237_public_smoking_area_station.csv", url: KOTO_DATA_URL },
  "musashino-public-smoking-areas": { filename: "doc.kml", url: MUSASHINO_DATA_URL },
  "minato-designated-smoking-areas": { filename: "minatokushisetsujoho_fukugo.csv", url: MINATO_DATA_URL },
  "kyoto-public-smoking-places": { filename: "20260903_shisetsu.csv", url: KYOTO_DATA_URL },
};
// Reviewed in the repository but not deployed to production (ADR-0018 D-C page re-check). Kept out of the production
// inventory above, which only a deployment expands; monitored only with --repository-reviewed.
const repositoryReviewedResources: Record<string, { filename: string; url: string }> = {
  "komatsu-airport-smoking-places": { filename: "komatsu-airport-page-facts.csv", url: KOMATSU_AIRPORT_PAGE_URL },
};
// Reviewed sources with no health target, and why. Every SOURCE_ADAPTERS entry is exactly one of: deployed, repository-
// reviewed, or listed here (test/source-health-unified.test.ts), so the --repository-reviewed count is never incidental.
export const HEALTH_NOT_CONFIGURED: Record<string, string> = {
  // The CSV itself could be fingerprinted, but every target needs a human-reviewed, scoped rights contract in
  // review-metadata.json and source health never writes a baseline itself. Sendai's licence review (fixture
  // rights-review.json) has no scoped terms-page fingerprint yet; adding one is a maintainer review.
  "sendai-kaigan-park-smoking-areas": "noReviewedRightsContract",
};
// ADR-0018 page-fact sources: the reviewed scoped fact text of the official page (PROVENANCE.md of the fixture).
const PAGE_FACTS: Record<string, NonNullable<HealthTarget["pageFact"]>> = {
  "komatsu-airport-smoking-places": {
    scope: { kind: "htmlText", ranges: [{ start: "[img:] 喫煙場所はどこですか。", end: "関連リンク" }], requiredMarkers: ["喫煙場所", "国際線２F出発ロビー", "バス乗り場付近"] },
    reviewedFingerprint: "e5fc9afb22df6e75a9d3b721c20b34d268443d073bc3d7df4f3223bb5b1f91c6",
  },
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
  // Production monitoring has an explicit inventory; repository onboarding alone never expands it.
  return healthTargets(resources);
}
/** The deployed inventory plus every repository-reviewed source that has health configured (see HEALTH_NOT_CONFIGURED). */
export function repositoryReviewedHealthTargets(): HealthTarget[] {
  const targets = healthTargets({ ...resources, ...repositoryReviewedResources });
  const ids = targets.map(target => target.adapter.registry.sourceId);
  for (const { registry: { sourceId } } of SOURCE_ADAPTERS) {
    if (ids.includes(sourceId) === sourceId in HEALTH_NOT_CONFIGURED)
      throw new Error(`Reviewed source ${sourceId} must be either a health target or in HEALTH_NOT_CONFIGURED, exactly one`);
  }
  return targets;
}
function healthTargets(inventory: Record<string, { filename: string; url: string }>): HealthTarget[] {
  return Object.entries(inventory).map(([sourceId, resource]) => {
    const adapter = SOURCE_ADAPTERS.find(candidate => candidate.registry.sourceId === sourceId);
    if (!adapter) throw new Error(`Production health inventory needs reviewed adapter: ${sourceId}`);
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
    const pageFact = PAGE_FACTS[adapter.registry.sourceId];
    if (pageFact) { target.pageFact = pageFact; target.mimeTypes = ["text/html"]; }
    if (adapter.registry.sourceId === "kyoto-public-smoking-places") {
      target.mimeTypes = [...target.mimeTypes, "application/force-download"];
      target.request = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ upload_file: "20260903182354_data（令和8年9月3日現在）.csv", download: "このデータをダウンロード" }).toString() };
    }
    return target;
  }).sort((a, b) => a.adapter.registry.sourceId.localeCompare(b.adapter.registry.sourceId));
}
// Only Osaka's mapnavi data host prefers 1024-bit DHE (see source-health-transport.ts). The narrower transport
// is scoped to exactly that source, request kind and hostname; rights pages and every other source keep
// Node's default fetch.
type Transport = { name: string; fetch: (url: string, init?: RequestInit) => Promise<Response> };
const DEFAULT_TRANSPORT: Transport = { name: "node-fetch", fetch: (url, init) => fetch(url, init) };
export function liveTransport(sourceId: string, kind: "data" | "rights", url: string): Transport {
  return sourceId === "osaka-designated-smoking-areas" && kind === "data" && new URL(url).hostname === "www.mapnavi.city.osaka.lg.jp"
    ? { name: "node-https-ecdhe-aead", fetch: ecdheAeadFetch } : DEFAULT_TRANSPORT;
}
export function sourceReviews(): SourceReview[] {
  return JSON.parse(readFileSync(new URL("../../data-pipeline/source-health/review-metadata.json", import.meta.url), "utf8")).sources;
}
// Offline replay: serves the reviewed fixtures (Musashino: the reviewed outer archive) through the same
// checker and evaluator. No network; rights pages are reported as notChecked.
function offlineFetch(targets: HealthTarget[]): (url: string) => Promise<Response> {
  return async url => {
    const target = targets.find(t => t.url === url);
    if (!target) throw new Error("offline mode refuses network access");
    const resource = { ...resources, ...repositoryReviewedResources }[target.adapter.registry.sourceId];
    const file = target.baselineResourceSha256 ? "toilet.zip" : resource.filename;
    const bytes = readFileSync(new URL(`${target.adapter.registry.sourceId}/${file}`, root));
    return new Response(bytes, { status: 200, headers: { "content-type": target.mimeTypes[0] } });
  };
}
// Offline, a page-fact source's page is not available (its HTML is never committed): probe only the reviewed fact sheet
// through the adapter and say so; the page itself is checked only live.
async function offlinePageFact(target: HealthTarget) {
  const probe: HealthTarget = { ...target, pageFact: undefined, mimeTypes: ["text/csv"] };
  const health = await checkSourceHealth(probe, { fetch: offlineFetch([probe]) });
  health.pageFactNotChecked = true;
  health.notes.push("Offline: the official page was not fetched; only the reviewed fact sheet was probed");
  return health;
}
const STDIO = { out: (text: string) => void process.stdout.write(text), err: (text: string) => void process.stderr.write(text) };
export async function main(args: string[] = process.argv.slice(2), now = new Date(), io = STDIO) {
  const mode = args.filter(arg => arg === "--live" || arg === "--offline");
  if (args.some(arg => arg !== "--live" && arg !== "--offline" && arg !== "--repository-reviewed" && !arg.startsWith("--source=")) || mode.length !== 1)
    throw new Error("Usage: npm run source:health -- (--live | --offline) [--repository-reviewed] [--source=source-id]");
  const live = mode[0] === "--live";
  const ids = args.filter(arg => arg.startsWith("--source=")).map(arg => arg.slice(9));
  const targets = args.includes("--repository-reviewed") ? repositoryReviewedHealthTargets() : productionHealthTargets();
  if (ids.some(id => !targets.some(t => t.adapter.registry.sourceId === id))) throw new Error("Unknown reviewed source id");
  const reviews = sourceReviews();
  // The metadata covers every health-configured source, deployed or repository-reviewed, exactly once.
  validateReviews(reviews, repositoryReviewedHealthTargets().map(t => t.adapter.registry.sourceId));
  // Sequential and exhaustive: every source (data and rights pages) is checked and reported even when
  // another fails; the exit code is decided only afterwards.
  const results = [];
  for (const target of targets.filter(t => !ids.length || ids.includes(t.adapter.registry.sourceId))) {
    const sourceId = target.adapter.registry.sourceId;
    const transport = live ? liveTransport(sourceId, "data", target.url) : { name: "offline-fixture", fetch: offlineFetch(targets) };
    const health = !live && target.pageFact ? await offlinePageFact(target) : await checkSourceHealth(target, { fetch: transport.fetch });
    const contracts = reviews.find(review => review.sourceId === sourceId)!.rights;
    const rights = [];
    for (const contract of contracts) rights.push(live ? await checkRights(contract, { fetch: liveTransport(sourceId, "rights", contract.url).fetch }) : notChecked(contract));
    results.push({ ...withRights(health, rights), transport: transport.name });
  }
  const report = buildReport(results, reviews, jstDate(now));
  io.out(JSON.stringify(report, null, 2) + "\n");
  io.err(renderSummary(report));
  process.exitCode = report.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 2; });
