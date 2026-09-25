// Read-only smoke verification for a running API (docs/OPERATIONS.md).
//
// LOCAL BY DEFAULT. With no arguments it targets http://127.0.0.1:8787 — the `wrangler dev --local`
// server. A non-loopback target is refused unless BOTH `--base-url <https url>` and `--remote` are
// given, so this script can never silently reach staging or production.
//
// It is read-only against canonical data: every request is a GET, except one deliberately invalid
// POST /v1/reports used to observe how the report endpoint is configured. That body fails schema
// validation (or the attestation gate) and therefore stores nothing. The script never submits a
// valid report and never writes to a database.
//
//   npm run local:smoke
//   npm run local:smoke -- --tile 14/14553/6450
//   node --experimental-strip-types scripts/smoke.ts --base-url https://staging.example --remote
//
// `--expect-reports unavailable|appAttest` additionally pins which report configuration the target
// must advertise, so the disposable App Attest environment (docs/OPERATIONS.md) can prove it failed
// closed before its App Attest values were set and speaks schema 2 after.
import { ifNoneMatchMatches } from "../src/app.ts";
import { DATA_TILE_ZOOM, parseTileId } from "../src/geo/tile.ts";
import { CONFIG_RESOURCES, ConfigBodyV1 } from "../src/config/dto.ts";
import { ATTESTED_REPORT_SCHEMA_VERSION } from "../src/reports/dto.ts";
import { SpotDetailBodyV1 } from "../src/spots/dto.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";

const LOCAL_BASE_URL = "http://127.0.0.1:8787";
/** A z14 tile far from any published data, used to verify the tileNotPublished 404. */
const EMPTY_TILE = `${DATA_TILE_ZOOM}/0/0`;
/** The tile the committed Taito fixture publishes (docs/API.md). Override with --tile. */
const DEFAULT_TILE = `${DATA_TILE_ZOOM}/14553/6450`;

function parseArgs(argv: string[]) {
  const args = { baseUrl: LOCAL_BASE_URL, tile: "", remote: false, expectReports: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--remote") args.remote = true;
    else if (arg === "--base-url") args.baseUrl = argv[++i] ?? "";
    else if (arg === "--tile") args.tile = argv[++i] ?? "";
    else if (arg === "--expect-reports") args.expectReports = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${arg}. Usage: smoke.ts [--base-url <url> --remote] [--tile z/x/y] [--expect-reports unavailable|appAttest]`);
  }
  const url = new URL(args.baseUrl);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (!loopback && !args.remote) {
    throw new Error(`refusing to reach ${url.origin}: a non-loopback target needs an explicit --remote`);
  }
  if (!loopback && url.protocol !== "https:") throw new Error(`refusing a non-https remote target: ${url.origin}`);
  if (!["", "unavailable", "appAttest"].includes(args.expectReports)) {
    throw new Error(`--expect-reports must be unavailable or appAttest, got ${args.expectReports}`);
  }
  if (args.tile !== "" && parseTileId(args.tile) === null) throw new Error(`--tile must be a canonical z/x/y id, got ${args.tile}`);
  return { ...args, baseUrl: url.origin, loopback };
}

const checks: { name: string; ok: boolean; note: string }[] = [];
function check(name: string, ok: boolean, note: string): boolean {
  checks.push({ name, ok, note });
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${note}`);
  return ok;
}

const args = parseArgs(process.argv.slice(2));
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${args.baseUrl}${path}`, { headers });

console.log(`target: ${args.baseUrl} (${args.loopback ? "local" : "REMOTE, explicitly opted in"})`);

// 1. /v1/config — the compatibility contract, and the zoom every later check depends on.
const configRes = await get("/v1/config");
const config = ConfigBodyV1.safeParse(configRes.status === 200 ? await configRes.json() : null);
// Per-resource compatibility: each resource must advertise a range this build could actually
// decode, and the range must be non-empty.
const ranges = config.success
  ? CONFIG_RESOURCES.map((r) => `${r}=${config.data.minimumSupportedSchemaVersions[r]}..${config.data.schemaVersions[r]}`).join(" ")
  : "";
const rangesOk = config.success
  && CONFIG_RESOURCES.every((r) => config.data.minimumSupportedSchemaVersions[r] <= config.data.schemaVersions[r]);
check("config", configRes.status === 200 && config.success && config.data.dataTileZoom === DATA_TILE_ZOOM && rangesOk,
  `status=${configRes.status} schema=${config.success ? "valid" : "invalid"} dataTileZoom=${config.success ? config.data.dataTileZoom : "?"} ${ranges}`);

// 2. A published tile: 200, a well-formed body and an ETag.
// With no --tile the default is the documented Taito tile: the only published data in the local
// fixture. The runbook passes --tile explicitly for any deployment holding different data.
const tileId = args.tile !== "" ? args.tile : DEFAULT_TILE;
const tileRes = await get(`/v1/tiles/${tileId}`);
const tile = tileRes.status === 200 ? TileBodyV1.safeParse(await tileRes.json()) : null;
const etag = tileRes.headers.get("ETag") ?? "";
// The served body must also sit inside the range /v1/config advertises for tiles.
const tileVersionOk = tile?.success === true && config.success
  && tile.data.schemaVersion >= config.data.minimumSupportedSchemaVersions.tile
  && tile.data.schemaVersion <= config.data.schemaVersions.tile;
const tileOk = check("tile 200", tileRes.status === 200 && tile?.success === true && etag !== "" && tileVersionOk,
  `tile=${tileId} status=${tileRes.status} etag=${etag || "missing"} spots=${tile?.success ? tile.data.spots.length : "?"} schemaVersion=${tile?.success ? tile.data.schemaVersion : "?"}`);

// 3. Conditional request on the same tile: 304 with the same ETag. "Same" is RFC 9110 weak
// comparison: a remote edge that gzips the 200 turns the tag weak (W/"…") but not the bodyless 304.
const notModified = tileOk ? await get(`/v1/tiles/${tileId}`, { "If-None-Match": etag }) : null;
check("tile 304", notModified?.status === 304 && ifNoneMatchMatches(notModified.headers.get("ETag") ?? undefined, etag),
  `status=${notModified?.status} etag=${notModified?.headers.get("ETag") ?? "missing"}`);

// 4. A valid z14 tile with nothing published: the documented 404 contract.
const emptyRes = await get(`/v1/tiles/${EMPTY_TILE}`);
const emptyBody = emptyRes.status === 404 ? await emptyRes.json() as { error?: string } : {};
check("tileNotPublished 404", emptyRes.status === 404 && emptyBody.error === "tileNotPublished",
  `tile=${EMPTY_TILE} status=${emptyRes.status} error=${emptyBody.error ?? "-"}`);

// 5. Spot detail for a spot the tile published.
const spotId = tile?.success ? tile.data.spots[0]?.id ?? "" : "";
const detailRes = spotId === "" ? null : await get(`/v1/spots/${spotId}`);
const detail = detailRes?.status === 200 ? SpotDetailBodyV1.safeParse(await detailRes.json()) : null;
const detailVersionOk = detail?.success === true && config.success
  && detail.data.schemaVersion >= config.data.minimumSupportedSchemaVersions.spotDetail
  && detail.data.schemaVersion <= config.data.schemaVersions.spotDetail;
check("spot detail", detail?.success === true && detail.data.spot.id === spotId && detailVersionOk,
  `spot=${spotId || "none in tile"} status=${detailRes?.status ?? "-"} schema=${detail === null ? "-" : detail.success ? "valid" : "invalid"}`);

// 6. Attribution: every source behind a published spot carries displayable attribution, in both
// endpoints and identically (docs/API.md). Losing it is a licence violation, not a cosmetic bug.
const tileSources = tile?.success ? tile.data.sources : [];
const referenced = new Set(tile?.success ? tile.data.spots.flatMap((s) => s.sourceIds) : []);
const missing = [...referenced].filter((id) => {
  const source = tileSources.find((s) => s.id === id);
  return source === undefined || source.attributionText === null || source.attributionText.trim() === "";
});
const detailSource = detail?.success ? detail.data.sources.find((s) => s.id === detail.data.spot.sourceIds[0]) : undefined;
const tileSource = tileSources.find((s) => s.id === detailSource?.id);
check("attribution", referenced.size > 0 && missing.length === 0
  && detailSource !== undefined && JSON.stringify(detailSource) === JSON.stringify(tileSource),
  `sources=${referenced.size} withoutAttribution=${missing.length} detailMatchesTile=${detailSource !== undefined && JSON.stringify(detailSource) === JSON.stringify(tileSource)}`);

// 7. Report endpoint configuration. The body is deliberately invalid, so nothing is stored whatever
// the answer; the point is which gate answers, and that it agrees with /v1/config.
const reportRes = await fetch(`${args.baseUrl}/v1/reports`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
const reportBody = await reportRes.json() as { error?: string };
const available = config.success ? config.data.reports.available : null;
const agrees = available === null ? false : available
  ? reportRes.status === 400 && reportBody.error === "invalidReport"
  : reportRes.status === 503 && reportBody.error === "attestationUnavailable";
check("report endpoint configuration", agrees && reportRes.status !== 201,
  `configReportsAvailable=${available} status=${reportRes.status} error=${reportBody.error ?? "-"}`
  + (available === false ? " (fail-closed; expected until the App Attest values are configured)" : ""));

// 8. Optional: the report configuration the operator expects at this point of the E2E sequence.
if (args.expectReports !== "") {
  const reports = config.success ? config.data.reports : null;
  const ok = reports !== null && (args.expectReports === "unavailable"
    ? !reports.available
    : reports.available && reports.attestation === "appAttest"
      && config.success && config.data.schemaVersions.report === ATTESTED_REPORT_SCHEMA_VERSION
      && config.data.minimumSupportedSchemaVersions.report === ATTESTED_REPORT_SCHEMA_VERSION);
  check(`reports ${args.expectReports}`, ok,
    `available=${reports?.available} attestation=${reports?.attestation ?? "-"} report=${config.success ? `${config.data.minimumSupportedSchemaVersions.report}..${config.data.schemaVersions.report}` : "?"}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
  console.error(`failed: ${failed.map((c) => c.name).join(", ")}`);
  process.exit(1);
}
