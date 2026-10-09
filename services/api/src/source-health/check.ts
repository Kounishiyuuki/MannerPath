// Advisory only: no database, retained bodies, registry writes, or publication.
import { sha256Hex } from "../db.ts";
import { observeSourceRecord, type SourceAdapter } from "../pipeline/source-adapter.ts";
import type { RightsObservation } from "./rights.ts";
export type HealthStatus = "healthy" | "moved" | "unavailable" | "accessBlocked" | "schemaChanged" | "contentChanged" | "rightsReviewRequired" | "unknown";
// Transport failure classes are symbolic; they never carry publisher bodies or arbitrary error text.
export type TransportFailure = "tls" | "timeout" | "network" | "sizeLimit" | "redirect" | "unknown";
// Independent observations: a primary status alone loses e.g. "moved AND contentChanged".
export interface HealthSignals {
  moved: boolean; crossOriginRelocation: boolean; accessBlocked: boolean; resourceMissing: boolean; serverError: boolean;
  rateLimited: boolean; unexpectedHttpStatus: boolean;
  transportFailure: TransportFailure | null; transportCode: string | null; mimeUnexpected: boolean;
  contentChanged: boolean; packagingChanged: boolean; schemaCompatible: boolean | null; parserCompatible: boolean | null;
  rightsReviewRequired: boolean; rightsChanged: boolean; rightsScopeMissing: boolean;
}
export interface HealthResult {
  sourceId: string; status: HealthStatus; httpStatus: number | null; finalUrl: string;
  contentType: string | null; etag?: string; lastModified?: string; contentLength?: string;
  bytes?: number; sha256?: string; payloadSha256?: string; rowCount?: number; observedRowCount?: number;
  header?: string[]; coordinateColumns?: string[]; schemaCompatible: boolean | null;
  parserCompatible: boolean | null; redirects: { url: string; status: number; location: string }[]; notes: string[];
  signals: HealthSignals; rights?: RightsObservation[];
}
export interface HealthTarget {
  adapter: SourceAdapter; url: string; baselineSha256: string; baselineResourceSha256?: string; baselineHeader: string[];
  mimeTypes: readonly string[]; request?: RequestInit;
  prepare?: (bytes: Uint8Array) => Uint8Array;
}
export interface HealthOptions { fetch: (url: string, init?: RequestInit) => Promise<Response>; timeoutMs?: number; maxBytes?: number; maxRedirects?: number }
export async function checkSourceHealth(target: HealthTarget, options: HealthOptions): Promise<HealthResult> {
  const maxBytes = options.maxBytes ?? 5_000_000, maxRedirects = options.maxRedirects ?? 5;
  const result: HealthResult = { sourceId: target.adapter.registry.sourceId, status: "unknown", httpStatus: null,
    finalUrl: target.url, contentType: null, schemaCompatible: null, parserCompatible: null, redirects: [], notes: [],
    signals: { moved: false, crossOriginRelocation: false, accessBlocked: false, resourceMissing: false, serverError: false,
      rateLimited: false, unexpectedHttpStatus: false, transportFailure: null, transportCode: null, mimeUnexpected: false, contentChanged: false, packagingChanged: false,
      schemaCompatible: null, parserCompatible: null, rightsReviewRequired: false, rightsChanged: false, rightsScopeMissing: false } };
  const signals = result.signals;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, options.timeoutMs ?? 20_000); });
  const bounded = <T>(promise: Promise<T>) => Promise.race([promise, deadline]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (target.adapter.registry.publicationStatus !== "approved" || !target.adapter.registry.licenseUrl || !target.adapter.registry.licenseName || !target.adapter.registry.attributionText) {
      result.status = "rightsReviewRequired"; signals.rightsReviewRequired = true; result.notes.push("Reviewed source rights metadata missing; no request made"); return result;
    }
    if (new URL(target.url).protocol !== "https:") throw new Error("HTTPS resource required");
    let url = target.url, request = target.request ?? {};
    let response: Response;
    for (;;) {
      response = await bounded(options.fetch(url, { ...request, redirect: "manual", signal: controller.signal }));
      result.httpStatus = response.status; result.finalUrl = url;
      result.contentType = response.headers.get("content-type");
      for (const [key, header] of [["etag", "etag"], ["lastModified", "last-modified"], ["contentLength", "content-length"]] as const) {
        const value = response.headers.get(header); if (value !== null) result[key] = value; else delete result[key];
      }
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers.get("location");
      void response.body?.cancel().catch(() => {});
      if (!location) throw new Error("redirect missing Location");
      const next = new URL(location, url);
      result.redirects.push({ url, status: response.status, location: next.href });
      if (next.protocol !== "https:" || next.origin !== new URL(target.url).origin) {
        result.status = "rightsReviewRequired"; signals.moved = signals.crossOriginRelocation = signals.rightsReviewRequired = true;
        result.notes.push("Cross-origin or non-HTTPS relocation requires publisher/resource/rights review; destination was not fetched"); return result;
      }
      if (result.redirects.length > maxRedirects) throw new Error("redirect limit exceeded");
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && request.method === "POST")) request = {};
      url = next.href;
    }
    // Only 200 is a success. Redirects are resolved above, so any other status left here (a raw 3xx, 304
    // without a conditional-request contract, other 2xx, 4xx, 5xx) is explicitly classified, never healthy.
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      result.status = response.status === 403 || response.status === 401 ? "accessBlocked" : "unavailable";
      signals.accessBlocked = result.status === "accessBlocked"; signals.resourceMissing = response.status === 404 || response.status === 410;
      signals.serverError = response.status >= 500 && response.status <= 599; signals.rateLimited = response.status === 429;
      signals.unexpectedHttpStatus = !signals.accessBlocked && !signals.resourceMissing && !signals.serverError && !signals.rateLimited;
      signals.moved = result.redirects.length > 0;
      result.notes.push(`HTTP ${response.status}; does not establish removal or rights expiry`); return result;
    }
    const mime = result.contentType?.split(";")[0].trim().toLowerCase();
    if (!mime || !target.mimeTypes.includes(mime)) { void response.body?.cancel().catch(() => {}); signals.mimeUnexpected = true; signals.moved = result.redirects.length > 0; result.notes.push("Unexpected or missing MIME; parser not attempted"); return result; }
    const declared = Number(result.contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) { void response.body?.cancel().catch(() => {}); throw new Error("response size limit exceeded (Content-Length)"); }
    const chunks: Uint8Array[] = []; let size = 0;
    reader = response.body?.getReader();
    if (reader) for (;;) {
      const chunk = await bounded(reader.read()); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > maxBytes) throw new Error("response size limit exceeded (stream)");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    result.bytes = size; result.sha256 = await sha256Hex(bytes);
    try {
      const payload = target.prepare ? target.prepare(bytes) : bytes;
      if (payload.byteLength > maxBytes) throw new Error("expanded payload size limit exceeded");
      result.payloadSha256 = await sha256Hex(payload);
      const parsed = target.adapter.parse(payload); result.parserCompatible = true;
      result.header = parsed.header; result.rowCount = parsed.rows.length;
      result.schemaCompatible = JSON.stringify(parsed.header) === JSON.stringify(target.baselineHeader) && parsed.rows.length > 0;
      const columns = new Set<string>(); let observed = 0;
      for (const row of parsed.rows) {
        if (target.adapter.includesRecord && !target.adapter.includesRecord(row)) continue;
        const observation = observeSourceRecord(target.adapter, row); observed++;
        for (const item of observation.provenance.filter(p => p.field === "location")) for (const column of item.columns) columns.add(column);
      }
      result.observedRowCount = observed; result.coordinateColumns = [...columns].sort();
      if (!observed) result.schemaCompatible = false;
      const payloadChanged = result.payloadSha256 !== target.baselineSha256;
      const resourceChanged = result.sha256 !== (target.baselineResourceSha256 ?? target.baselineSha256);
      Object.assign(signals, { moved: result.redirects.length > 0, contentChanged: payloadChanged || resourceChanged,
        packagingChanged: resourceChanged && !payloadChanged, schemaCompatible: result.schemaCompatible, parserCompatible: true });
      result.status = !result.schemaCompatible ? "schemaChanged" : result.redirects.length ? "moved" : payloadChanged || resourceChanged ? "contentChanged" : "healthy";
      if (result.redirects.length) result.notes.push("Relocation observed; no URL or rights approval is inferred; human review required");
      if (resourceChanged && !payloadChanged) result.notes.push("Fetched resource bytes differ but extracted payload is unchanged; packaging review required");
      if (payloadChanged) result.notes.push("Payload differs from reviewed fixture; separate release review required");
    } catch {
      result.parserCompatible = false; result.schemaCompatible = false; result.status = "schemaChanged";
      Object.assign(signals, { moved: result.redirects.length > 0, contentChanged: result.sha256 !== (target.baselineResourceSha256 ?? target.baselineSha256),
        schemaCompatible: false, parserCompatible: false }); result.notes.push("Archive/parser/observation probe failed; no raw row values retained"); }
    return result;
  } catch (error) {
    result.status = "unavailable"; result.notes.push(error instanceof Error ? error.message : "HTTP operation failed");
    // Only expose a bounded symbolic transport code, never arbitrary cause messages/data.
    const cause = error instanceof Error ? error.cause : null;
    const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
      && /^[A-Z][A-Z0-9_]{0,79}$/.test(cause.code) ? cause.code : null;
    if (code) result.notes.push(`Transport error code: ${code}`);
    signals.transportCode = code; signals.moved = result.redirects.length > 0;
    signals.transportFailure = transportFailure(error instanceof Error ? error.message : "", code);
    return result;
  } finally { clearTimeout(timer!); controller.abort(); if (reader) void reader.cancel().catch(() => {}); }
}

export function transportFailure(message: string, code: string | null): TransportFailure {
  if (message === "timeout" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") return "timeout";
  if (message.startsWith("response size limit") || message.startsWith("expanded payload size")) return "sizeLimit";
  if (message.startsWith("redirect")) return "redirect";
  if (code && (/^ERR_(SSL|TLS)_/.test(code) || /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/.test(code))) return "tls";
  if (code && ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET"].includes(code)) return "network";
  return "unknown";
}
