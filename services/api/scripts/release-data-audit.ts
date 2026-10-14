// Explicit, bounded GET-only observation of deployed public data. No inventory completeness claim.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ConfigBodyV1 } from '../src/config/dto.ts';
import { PromotionReadinessV1 } from '../src/pipeline/promotion-readiness.ts';
import { SpotDetailBodyV1 } from '../src/spots/dto.ts';
import { TileManifestV2, TilePartBodyV2, type TileSpotV1, type TileSourceV1 } from '../src/tiles/dto.ts';
import { parseTileId, tileForCoordinate, formatTileId } from '../src/geo/tile.ts';

export const PRODUCTION_ORIGIN = 'https://mannerpath-api-production.happywestyuki.workers.dev';
const MAX_BYTES = 1_048_576;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function validateTiles(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100 || input.some(t => typeof t !== 'string' || parseTileId(t)?.z !== 14)
    || new Set(input).size !== input.length) throw new Error('Expected 1..100 distinct canonical z14 tile IDs');
  return input;
}
function validateSource(source: TileSourceV1) {
  if (![source.id, source.displayName, source.licenseName, source.attributionText].every(v => typeof v === 'string' && v.trim().length > 0)) throw new Error('Missing source attribution');
  let url: URL;
  try { url = new URL(source.licenseUrl ?? ''); } catch { throw new Error('Missing source license URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid source license URL');
}
export async function collectProductionAudit(input: unknown, fetcher: typeof fetch = fetch) {
  const queriedTiles = validateTiles(input);
  const startedAt = new Date().toISOString();
  let requests = 0;
  async function get(path: string, tileResource = false) {
    if (++requests > 512) throw new Error('Total GET request budget exceeded');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(PRODUCTION_ORIGIN + path, { method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
      if (response.status !== 200) { await response.body?.cancel(); throw new Error(`GET ${path}: status ${response.status}`); }
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) { await response.body?.cancel(); throw new Error('Expected JSON response'); }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Response exceeds byte limit'); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing response body');
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.length;
        if (length > MAX_BYTES) { await reader.cancel(); throw new Error('Response exceeds byte limit'); }
        chunks.push(chunk.value);
      }
      const bytes = Buffer.concat(chunks); const digest = sha(bytes);
      const etag = response.headers.get('etag');
      if (tileResource && etag !== null && etag.replace(/^W\//, '') !== `"2-${digest}"`) throw new Error('Tile ETag disagrees with response bytes');
      let json: unknown;
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Error('Invalid JSON response'); }
      return { json, digest, etag };
    } finally { clearTimeout(timeout); }
  }
  const readiness = PromotionReadinessV1.parse((await get('/v1/readiness')).json);
  if (!readiness.completed || readiness.state !== 'completed') throw new Error('Production promotion is incomplete');
  const config = ConfigBodyV1.parse((await get('/v1/config')).json);
  if (config.dataTileZoom !== 14 || config.reports.available || config.reports.photoEvidenceEnabled) throw new Error('Release requires z14 and reports/photos disabled');
  const sources = new Map<string, TileSourceV1>();
  const spots = new Map<string, TileSpotV1>();
  const sourceCounts: Record<string, number> = {};
  const tileObservations: { tile: string; revision: number; generatedAt: string; spotCount: number; manifestSha256: string; etag: string | null; parts: { index: number; spotCount: number; sha256: string }[] }[] = [];
  let partsRead = 0;
  for (const tile of queriedTiles) {
    const first = await get(`/v1/tiles/${tile}/manifest`, true);
    const manifest = TileManifestV2.parse(first.json);
    if (manifest.tile !== tile || manifest.parts.length > 128 || manifest.partPolicy !== 'tile-parts.v1') throw new Error('Unexpected manifest identity or part policy');
    if ((partsRead += manifest.parts.length) > 256) throw new Error('Total part budget exceeded');
    for (const entry of manifest.parts) {
      const response = await get(`/v1/tiles/${tile}/parts/${entry.index}`, true);
      const part = TilePartBodyV2.parse(response.json);
      if (response.digest !== entry.sha256 || part.tile !== tile || part.part !== entry.index || part.partCount !== manifest.parts.length || part.spots.length !== entry.spotCount) throw new Error('Part identity/hash/count mismatch');
      const partSources = new Map<string, TileSourceV1>();
      for (const source of part.sources) {
        validateSource(source);
        if (partSources.has(source.id)) throw new Error('Duplicate part source');
        if (sources.has(source.id) && JSON.stringify(sources.get(source.id)) !== JSON.stringify(source)) throw new Error('Inconsistent source metadata');
        partSources.set(source.id, source); sources.set(source.id, source);
      }
      for (const spot of part.spots) {
        if (spots.has(spot.id)) throw new Error('Duplicate spot across parts/tiles');
        if (formatTileId(tileForCoordinate(spot.latitude, spot.longitude, 14)) !== tile) throw new Error('Spot coordinate outside owning tile');
        if (new Set(spot.sourceIds).size !== spot.sourceIds.length || spot.sourceIds.some(id => !partSources.has(id))) throw new Error('Spot source attribution missing or duplicate');
        spots.set(spot.id, spot);
        for (const id of spot.sourceIds) sourceCounts[id] = (sourceCounts[id] ?? 0) + 1;
      }
    }
    const second = await get(`/v1/tiles/${tile}/manifest`, true);
    if (first.digest !== second.digest) throw new Error('Manifest changed during observation; rerun complete scan');
    tileObservations.push({ tile, revision: manifest.revision, generatedAt: manifest.generatedAt, spotCount: manifest.spotCount, manifestSha256: first.digest, etag: first.etag, parts: manifest.parts });
  }
  if (sources.size > 20) throw new Error('Source detail request budget exceeded');
  const values = [...spots.values()];
  const detailSamples = [];
  for (const sourceId of sources.keys()) {
    const spot = values.find(s => s.sourceIds.includes(sourceId));
    if (!spot) throw new Error('Unreferenced tile source');
    const detail = SpotDetailBodyV1.parse((await get(`/v1/spots/${spot.id}`)).json);
    const { tile, ...detailSpot } = detail.spot;
    if (detail.requestedId !== spot.id || detail.mergedInto !== null || JSON.stringify(detailSpot) !== JSON.stringify(spot)
      || !queriedTiles.includes(tile) || detail.sources.length !== spot.sourceIds.length
      || detail.sources.some(s => JSON.stringify(s) !== JSON.stringify(sources.get(s.id)))
      || !spot.sourceIds.every(id => detail.sources.some(s => s.id === id))) throw new Error('Public detail differs from observed tile');
    detailSamples.push({ sourceId, spotId: spot.id, name: spot.name, tile, provenance: detail.provenance });
  }
  return {
    schemaVersion: 1, origin: PRODUCTION_ORIGIN, startedAt, observedAt: new Date().toISOString(),
    scope: 'Explicit bounded tile footprint; no global inventory endpoint. Does not prove absence of other published tiles.',
    queriedTiles, readiness, schemaVersions: config.schemaVersions, minimumSupportedSchemaVersions: config.minimumSupportedSchemaVersions, reportsAvailable: config.reports.available, photoEvidenceEnabled: config.reports.photoEvidenceEnabled,
    counts: { tiles: queriedTiles.length, spots: values.length, sources: sources.size,
      areaApproximate: values.filter(s => s.verification.locationPrecision === 'areaApproximate').length,
      accessUnknown: values.filter(s => s.accessType === 'unknown').length,
      hoursUnknown: values.filter(s => s.openingHours.status !== 'parsed').length,
      verifiedDateUnknown: values.filter(s => s.lastVerifiedAt === null).length },
    sourceCounts, sourceStats: [...sources.keys()].map(sourceId => {
      const members = values.filter(s => s.sourceIds.includes(sourceId));
      return { sourceId, spots: members.length, areaApproximate: members.filter(s => s.verification.locationPrecision === 'areaApproximate').length,
        accessUnknown: members.filter(s => s.accessType === 'unknown').length, hoursUnknown: members.filter(s => s.openingHours.status !== 'parsed').length,
        lastVerifiedDates: [...new Set(members.map(s => s.lastVerifiedAt))].sort() };
    }), sources: [...sources.values()], tiles: tileObservations, detailSamples,
    screenshotCandidates: detailSamples.map(({ sourceId, spotId, name, tile }) => ({ sourceId, spotId, name, tile })),
  };
}
export async function run(argv: string[], fetcher: typeof fetch = fetch) {
  if (argv.length !== 4 || argv[0] !== '--tiles' || argv[2] !== '--out' || !argv[1] || !argv[3]) throw new Error('Usage: release-data-audit.ts --tiles <tile-array.json> --out <fresh-report.json>');
  if (!statSync(argv[1]).isFile() || statSync(argv[1]).size > 16_384) throw new Error('Invalid tile list file');
  // Claim a fresh output before any network request, preventing accidental overwrite, including symlinks.
  const { openSync, closeSync, unlinkSync } = await import('node:fs');
  const fd = openSync(argv[3], 'wx', 0o600);
  try {
    const report = await collectProductionAudit(JSON.parse(readFileSync(argv[1], 'utf8')), fetcher);
    writeFileSync(fd, JSON.stringify(report, null, 2) + '\n');
    return report;
  } catch (error) { unlinkSync(argv[3]); throw error; }
  finally { closeSync(fd); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch(() => { console.error('Release audit failed; no complete report produced. Check tile footprint and public API contracts.'); process.exitCode = 1; });
}
