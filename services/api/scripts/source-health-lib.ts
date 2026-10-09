// Node-only, read-only diagnostics. No database, registry or publication mutations.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { productionHealthTargets } from './source-health.ts';
import { observeSourceRecord, type SourceAdapter } from '../src/pipeline/source-adapter.ts';
import { readZipMembers } from '../../data-pipeline/discovery/gis.mjs';

export type HealthStatus = 'healthy' | 'moved' | 'temporarilyUnavailable' | 'accessBlocked' | 'schemaChanged' | 'contentChanged' | 'rightsReviewRequired' | 'removed' | 'unknown';
export interface DownloadOptions {
  timeoutMs?: number; maxBytes?: number; maxRedirects?: number; fetchImpl?: typeof fetch;
  method?: string; body?: string; headers?: Record<string, string>; expectedTypes?: string[];
}
export async function boundedDownload(url: string, options: DownloadOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 15000, maxBytes = options.maxBytes ?? 8 * 1024 * 1024, maxRedirects = options.maxRedirects ?? 3;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0) throw new Error('invalid download limits');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('download timeout')), timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('download timeout')), { once: true }));
  let current = url, method = options.method ?? 'GET', body = options.body;
  try {
    for (let redirects = 0; ; redirects++) {
      if (new URL(current).protocol !== 'https:') throw new Error('only HTTPS downloads allowed');
      const response = await Promise.race([fetchImpl(current, { method, body, headers: options.headers, signal: controller.signal, redirect: 'manual' }), deadline]);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        if (redirects >= maxRedirects) throw new Error('redirect limit exceeded');
        const location = response.headers.get('location');
        if (!location) throw new Error('redirect without location');
        const next = new URL(location, current).href;
        // Do not follow cross-origin redirects or forward POST state to another publisher.
        if (new URL(next).origin !== new URL(url).origin) throw new Error('cross-origin redirect requires review');
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
        current = next; continue;
      }
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (response.ok && options.expectedTypes && !options.expectedTypes.includes(contentType)) { void response.body?.cancel().catch(() => {}); throw new Error(`unexpected content-type: ${contentType || 'missing'}`); }
      if (Number(response.headers.get('content-length')) > maxBytes) { void response.body?.cancel().catch(() => {}); throw new Error('response byte limit exceeded'); }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) {
        try { for (;;) {
          const part = await Promise.race([reader.read(), deadline]);
          if (part.done) break;
          size += part.value.length;
          if (size > maxBytes) throw new Error('response byte limit exceeded');
          chunks.push(part.value);
        } } finally { void reader.cancel().catch(() => {}); }
      }
      return { url: current, status: response.status, contentType, bytes: Buffer.concat(chunks), redirects, lastModified: response.headers.get('last-modified') };
    }
  } finally { clearTimeout(timer); controller.abort(); }
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function diagnosticError(error: unknown): string {
  const cause = error instanceof Error ? error.cause : null;
  const causeCode = cause && typeof cause === 'object' ? Reflect.get(cause, 'code') : null;
  const causeMessage = cause && typeof cause === 'object' ? Reflect.get(cause, 'message') : null;
  // TLS/OpenSSL messages can contain process addresses; stable codes keep JSON reproducible.
  const detail = typeof causeCode === 'string' ? causeCode : typeof causeMessage === 'string' ? causeMessage : '';
  return (String(error) + (detail ? `; cause: ${detail}` : '')).slice(0, 1024);
}
export function probePayload(adapter: SourceAdapter, bytes: Uint8Array, baselineBytes: Uint8Array) {
  const result = { schema: 'same' as 'same' | 'changed' | 'unknown', parser: 'pass' as 'pass' | 'fail', content: sha256(bytes) === sha256(baselineBytes) ? 'same' : 'changed', sha256: sha256(bytes), header: [] as string[], rowCount: 0, observationCount: 0, error: null as string | null };
  let parsed;
  try {
    parsed = adapter.parse(bytes); result.header = parsed.header; result.rowCount = parsed.rows.length;
    const baseline = adapter.parse(baselineBytes);
    if (JSON.stringify(parsed.header) !== JSON.stringify(baseline.header)) result.schema = 'changed';
  } catch (error) { result.schema = /header|schema|KML|XML/i.test(String(error)) ? 'changed' : 'unknown'; result.parser = 'fail'; result.error = String(error); return result; }
  try { for (const row of parsed.rows) { if (adapter.includesRecord && !adapter.includesRecord(row)) continue; observeSourceRecord(adapter, row); result.observationCount++; } }
  catch (error) { result.parser = 'fail'; result.error = String(error); }
  return result;
}
export function classifyHealth(input: { availability: string; moved?: boolean; schema?: string; parser?: string; content?: string; rights?: string; removedEvidence?: boolean }): HealthStatus {
  if (input.removedEvidence) return 'removed';
  if (['changed', 'reviewRequired'].includes(input.rights ?? '')) return 'rightsReviewRequired';
  if (input.availability === 'accessBlocked') return 'accessBlocked';
  if (input.availability === 'temporarilyUnavailable') return 'temporarilyUnavailable';
  if (input.availability !== 'available') return 'unknown';
  if (input.schema === 'changed' || input.parser === 'fail') return 'schemaChanged';
  if (input.content === 'changed') return 'contentChanged';
  return input.moved ? 'moved' : 'healthy';
}
const definitions = [
  ['taito-public-smoking-areas', '20260818_koshukitsuenjo.csv', 'csv'],
  ['osaka-designated-smoking-areas', 'opendata_1012.csv', 'csv'],
  ['koto-station-smoking-areas', '131083_237_public_smoking_area_station.csv', 'csv'],
  ['kyoto-public-smoking-places', '20260903_shisetsu.csv', 'csv'],
  ['musashino-public-smoking-areas', 'doc.kml', 'zip'],
  ['minato-designated-smoking-areas', 'minatokushisetsujoho_fukugo.csv', 'csv'],
] as const;
const rightsPages: Record<string, string[]> = {
  'taito-public-smoking-areas': ['https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html'],
  'osaka-designated-smoking-areas': ['https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html'],
  'koto-station-smoking-areas': ['https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t131083d0000000061', 'https://portal.data.metro.tokyo.lg.jp/terms/'],
  'kyoto-public-smoking-places': ['https://data.city.kyoto.lg.jp/resource/?id=21432', 'https://data.city.kyoto.lg.jp/dataset/00003/', 'https://data.city.kyoto.lg.jp/contents.php?category=0'],
  'musashino-public-smoking-areas': ['https://www.city.musashino.lg.jp/shiseijoho/tokeishiryo/chiikiseikatsu_kankyoshihyo/1040384/1040390.html'],
  'minato-designated-smoking-areas': ['https://opendata.city.minato.tokyo.jp/api/3/action/package_show?id=c02688a0-2e85-4637-aa36-edb37b3d010b', 'https://opendata.city.minato.tokyo.jp/about', 'https://opendata.city.minato.tokyo.jp/pages/exhibit'],
};
// Reuse the existing approved inventory and transport URLs; this extension grants no new target.
const targets = productionHealthTargets();
export const HEALTH_SOURCES = definitions.map(([sourceId, file, format]) => {
  const target = targets.find(t => t.adapter.registry.sourceId === sourceId);
  if (!target) throw new Error(`Missing existing production health target: ${sourceId}`);
  return { sourceId, adapter: target.adapter, dataUrl: target.url, format,
    fixture: new URL(`../../data-pipeline/fixtures/${sourceId}/${file}`, import.meta.url) };
});
export interface RightsFingerprint { url: string; sha256: string | null; httpStatus: number | null; error: string | null }
export interface PreviousHealth { sourceId: string; downloadSha256?: string | null; rights?: { fingerprints?: RightsFingerprint[] } }
export async function auditSource(config: typeof HEALTH_SOURCES[number], options: DownloadOptions & { live?: boolean; previous?: PreviousHealth } = {}) {
  const baseline = new Uint8Array(await readFile(config.fixture));
  const base = { sourceId: config.sourceId, mode: options.live ? 'live' : 'fixture', requestedUrl: config.dataUrl, finalUrl: config.dataUrl, availability: 'available', httpStatus: null as number | null, contentType: null as string | null, downloadSha256: null as string | null, downloadedBytes: 0, redirects: 0, freshness: { baselineObservedOn: config.sourceId === 'taito-public-smoking-areas' ? '2026-08-18' : config.sourceId === 'kyoto-public-smoking-places' ? '2026-09-03' : null, publisherLastModified: null as string | null, currentOperationConfirmed: false }, rights: { fingerprints: [] as RightsFingerprint[], status: options.live ? 'unknown' : 'reviewedBaseline', licenseName: config.adapter.registry.licenseName, licenseUrl: config.adapter.registry.licenseUrl, note: 'Transport and payload equality do not establish continued rights; review current publisher terms independently.' }, probe: null as ReturnType<typeof probePayload> | null, status: 'unknown' as HealthStatus, error: null as string | null };
  if (options.live) {
    for (const url of rightsPages[config.sourceId]) {
      const fingerprint: RightsFingerprint = { url, sha256: null, httpStatus: null, error: null };
      try {
        const response = await boundedDownload(url, { ...options, method: 'GET', body: undefined, expectedTypes: url.includes('/api/3/') ? ['application/json', 'text/json'] : ['text/html', 'application/xhtml+xml'] });
        fingerprint.httpStatus = response.status;
        if (response.status >= 200 && response.status < 300) fingerprint.sha256 = sha256(response.bytes);
      } catch (error) { fingerprint.error = diagnosticError(error); }
      base.rights.fingerprints.push(fingerprint);
    }
    const previous = options.previous?.rights?.fingerprints;
    if (previous && base.rights.fingerprints.some(page => page.sha256 && previous.some(old => old.url === page.url && old.sha256 && old.sha256 !== page.sha256))) base.rights.status = 'reviewRequired';
    // Matching pages only attest byte continuity, never legal approval. Missing pages remain unknown.
    else if (previous && base.rights.fingerprints.every(page => page.sha256 && previous.some(old => old.url === page.url && old.sha256 === page.sha256))) base.rights.status = 'unchanged';
  }
  try {
    let payload = baseline;
    if (options.live) {
      const kyoto = config.sourceId === 'kyoto-public-smoking-places';
      const download = await boundedDownload(config.dataUrl, { ...options, ...(kyoto ? { method: 'POST', body: new URLSearchParams({ upload_file: '20260903182354_data（令和8年9月3日現在）.csv', download: 'このデータをダウンロード' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}), expectedTypes: config.format === 'zip' ? ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'] : ['text/csv', 'application/csv', 'text/plain', 'application/octet-stream', 'application/vnd.ms-excel', 'binary/octet-stream', ...(kyoto ? ['application/force-download'] : []), ...(config.sourceId === 'osaka-designated-smoking-areas' ? ['text/comma-separated-values'] : [])] });
      Object.assign(base, { finalUrl: download.url, httpStatus: download.status, contentType: download.contentType, downloadSha256: sha256(download.bytes), downloadedBytes: download.bytes.length, redirects: download.redirects });
      base.freshness.publisherLastModified = download.lastModified;
      base.availability = [401, 403, 429].includes(download.status) ? 'accessBlocked' : [404, 410].includes(download.status) ? 'notFound' : download.status >= 500 ? 'temporarilyUnavailable' : download.status >= 200 && download.status < 300 ? 'available' : 'unknown';
      if (base.availability !== 'available') { base.status = classifyHealth({ ...base, rights: base.rights.status }); return base; }
      payload = download.bytes;
      if (config.format === 'zip') {
        const members: Map<string, Uint8Array> = readZipMembers(payload, { maxBytes: options.maxBytes ?? 8 * 1024 * 1024, maxMembers: 64 });
        // Legacy ZIP names are CP932; the existing safe reader exposes UTF-8 replacement names.
        // Match the exact decoded legacy filename from the pinned publisher archive.
        const reviewedLegacyName = "KML/\ufffdg\ufffdC\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\u0458H\ufffd\ufffd\u0589\ufffd\ufffdG\ufffd\ufffd\ufffdA\ufffdE\ufffd\ufffd\ufffdO\ufffdi\ufffd\ufffd\ufffd\ufffd.kmz";
        const kmzMembers = [...members.entries()].filter(([name]) => name === reviewedLegacyName);
        if (kmzMembers.length !== 1) throw new Error('archive must contain one publisher KML/KMZ layer');
        const kmz = kmzMembers[0][1];
        if (!kmz) throw new Error('archive missing reviewed KMZ member');
        const inner: Map<string, Uint8Array> = readZipMembers(kmz, { maxBytes: options.maxBytes ?? 8 * 1024 * 1024, maxMembers: 64 });
        const kml = inner.get('doc.kml');
        if (!kml) throw new Error('KMZ missing reviewed doc.kml member');
        payload = kml;
      }
    }
    base.probe = probePayload(config.adapter, payload, baseline);
    const previousDownload = options.previous?.downloadSha256;
    const driftSincePrevious = previousDownload && base.downloadSha256 && previousDownload !== base.downloadSha256;
    base.status = classifyHealth({ ...base, ...base.probe, ...(driftSincePrevious ? { content: 'changed' } : {}), rights: base.rights.status, moved: base.finalUrl !== base.requestedUrl });
  } catch (error) { base.error = diagnosticError(error); base.availability = /timeout|fetch failed|network/i.test(base.error) ? 'temporarilyUnavailable' : 'unknown'; base.status = classifyHealth({ ...base, rights: base.rights.status }); }
  return base;
}
export function deterministicJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item !== null && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, val]) => [key, sort(val)])) : item;
  return JSON.stringify(sort(value), null, 2) + '\n';
}
