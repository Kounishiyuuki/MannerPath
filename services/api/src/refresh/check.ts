// Source check: fetch -> fingerprint -> retain raw bytes (R2) -> compare -> record (ADR-0008 decision 9,
// "Amendment 2026-09 — source refresh foundation"). Source-agnostic: everything source-specific comes from
// the adapter (its refresh URL and its parser/mapping, run read-only as drift probes).
//
// A check writes only raw_artifacts, source_checks and source_refresh_candidates. It deliberately does not
// import ingest, resolve, publish or promotion (test/source-refresh.test.ts holds it to that): a changed file
// is a review candidate, and turning it into a release, spots or tiles stays the reviewed flow's job.

import { type Db, isoSeconds, sha256Hex } from "../db.ts";
import { observeSourceRecord, type SourceAdapter } from "../pipeline/source-adapter.ts";
import { type RawArtifactStore, rawArtifactKey } from "./artifact-store.ts";
import { SOURCE_REFRESH_POLICY } from "./policy.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CheckDeps {
  db: Db;
  store: RawArtifactStore;
  fetch: FetchLike;
  now: () => Date;
}

export interface CheckRequest {
  /** Identifies the run; a retry of the same run for the same source writes nothing new. */
  runKey: string;
  trigger: "scheduled" | "manual";
}

export type CheckOutcome = "unchanged" | "changed" | "needsReview" | "failed";

export interface Finding {
  id: string;
  detail: string;
}

export type CheckResult =
  | { status: "recorded"; reused: boolean; checkId: number; outcome: CheckOutcome; contentSha256: string | null; candidateId: number | null }
  /** Nothing was written: the source has no refresh target or no registry row to hang history on. */
  | { status: "skipped"; reason: string };

interface CheckRow {
  check_id: number;
  outcome: CheckOutcome;
  content_sha256: string | null;
}

class CheckFailure extends Error {
  readonly stage: "fetch" | "http" | "tooLarge" | "storage";
  constructor(stage: CheckFailure["stage"], detail: string) {
    super(detail);
    this.stage = stage;
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function checkSource(deps: CheckDeps, adapter: SourceAdapter, request: CheckRequest): Promise<CheckResult> {
  const { db } = deps;
  const sourceId = adapter.registry.sourceId;
  const target = adapter.refreshTarget;
  if (!target) return { status: "skipped", reason: `${sourceId} has no refresh target` };
  const checkKey = `${request.runKey}:${sourceId}`;

  const existing = await readCheck(db, checkKey);
  if (existing) return recorded(db, existing, sourceId, true);

  // History hangs off the registry row; a check never creates one (that is the reviewed registry step).
  const source = await db.prepare("SELECT 1 AS present FROM sources WHERE source_id = ?").bind(sourceId).first();
  if (!source) return { status: "skipped", reason: `${sourceId} has no sources row; register or promote it first` };

  const startedAt = isoSeconds(deps.now());
  const baselineCheck = await db.prepare(
    `SELECT check_id, content_sha256 FROM source_checks WHERE source_id = ? AND outcome <> 'failed'
     ORDER BY check_id DESC LIMIT 1`,
  ).bind(sourceId).first<{ check_id: number; content_sha256: string }>();
  const baselineRelease = await db.prepare(
    "SELECT release_id, content_sha256, header_json, record_count FROM source_releases WHERE source_id = ? AND is_current = 1",
  ).bind(sourceId).first<{ release_id: number; content_sha256: string; header_json: string; record_count: number }>();

  const row: Record<string, unknown> = {
    check_key: checkKey, source_id: sourceId, trigger_kind: request.trigger, policy_version: SOURCE_REFRESH_POLICY.version,
    request_url: target.url, started_at: startedAt, final_url: null, http_status: null, http_etag: null,
    http_last_modified: null, http_content_type: null, content_sha256: null, byte_length: null, artifact_sha256: null,
    header_json: null, record_count: null, outcome: "failed", failure_stage: null, findings_json: "[]", detail: null,
    baseline_check_id: baselineCheck?.check_id ?? null, baseline_release_id: baselineRelease?.release_id ?? null,
  };
  let bytes: Uint8Array | null = null;
  let storedNew = false;

  try {
    let response: Response;
    try {
      response = await deps.fetch(target.url, { redirect: "follow" });
    } catch (e) {
      throw new CheckFailure("fetch", `fetch ${target.url} failed: ${describe(e)}`);
    }
    Object.assign(row, {
      final_url: response.url || target.url, http_status: response.status, http_etag: response.headers.get("ETag"),
      http_last_modified: response.headers.get("Last-Modified"), http_content_type: response.headers.get("Content-Type"),
    });
    if (!response.ok) throw new CheckFailure("http", `HTTP ${response.status} from ${target.url}`);
    const declared = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > SOURCE_REFRESH_POLICY.maxBytes) {
      throw new CheckFailure("tooLarge", `Content-Length ${declared} exceeds ${SOURCE_REFRESH_POLICY.maxBytes}`);
    }
    bytes = await readCapped(response, SOURCE_REFRESH_POLICY.maxBytes, target.url);
    const sha = await sha256Hex(bytes);
    Object.assign(row, { content_sha256: sha, byte_length: bytes.byteLength });

    // Retain before recording, so D1 never names an object R2 does not hold. A failure after this point
    // leaves at most an unreferenced object under its own hash, which the next check of the same bytes reuses.
    storedNew = await retain(deps.store, sha, bytes);
    row.artifact_sha256 = sha;

    const previousSha = baselineCheck?.content_sha256 ?? baselineRelease?.content_sha256 ?? null;
    if (sha === previousSha) {
      row.outcome = "unchanged";
    } else {
      const probe = await probeDrift(db, adapter, bytes, baselineRelease, target.url, row.final_url as string);
      Object.assign(row, {
        header_json: probe.header === null ? null : JSON.stringify(probe.header), record_count: probe.recordCount,
        findings_json: JSON.stringify(probe.findings), outcome: probe.findings.length > 0 ? "needsReview" : "changed",
      });
    }
  } catch (e) {
    if (!(e instanceof CheckFailure)) throw e;
    Object.assign(row, { outcome: "failed", failure_stage: e.stage, detail: e.message, artifact_sha256: null });
  }
  row.finished_at = isoSeconds(deps.now());

  const statements = [];
  if (row.artifact_sha256 !== null) {
    statements.push(db.prepare(
      `INSERT INTO raw_artifacts (content_sha256, storage_key, byte_length, stored_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (content_sha256) DO NOTHING`,
    ).bind(row.artifact_sha256, rawArtifactKey(row.artifact_sha256 as string), row.byte_length, row.finished_at));
  }
  const columns = Object.keys(row);
  statements.push(db.prepare(`INSERT INTO source_checks (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .bind(...columns.map((c) => row[c])));
  if (row.outcome === "changed" || row.outcome === "needsReview") {
    // Content that already is a release of this source (e.g. the source reverted to the applied file) needs
    // no candidate: it has been through review. Content already queued keeps its first candidate.
    statements.push(db.prepare(
      `INSERT INTO source_refresh_candidates (source_id, artifact_sha256, check_id, review_state, created_at)
       SELECT ?, ?, (SELECT check_id FROM source_checks WHERE check_key = ?), ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM source_releases WHERE source_id = ? AND content_sha256 = ?)
       ON CONFLICT (source_id, artifact_sha256) DO NOTHING`,
    ).bind(sourceId, row.artifact_sha256, checkKey, row.outcome, row.finished_at, sourceId, row.artifact_sha256));
  }
  try {
    await db.batch(statements);
  } catch (e) {
    // A concurrent attempt of the same run recorded first: that row is the result, and this one wrote nothing.
    const raced = await readCheck(db, checkKey);
    if (raced) return recorded(db, raced, sourceId, true);
    throw new Error(`source check ${checkKey}: recording failed (${storedNew ? "a new" : "no new"} R2 object was written): ${describe(e)}`);
  }
  const written = await readCheck(db, checkKey);
  if (!written) throw new Error(`source check ${checkKey}: row was not stored`);
  return recorded(db, written, sourceId, false);
}

/**
 * Reads the body chunk by chunk and stops as soon as more than maxBytes have arrived, whatever
 * Content-Length claimed (it may be absent or understated): the reader is cancelled and nothing past the
 * limit is read or kept.
 */
async function readCapped(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {}); // the check already fails as tooLarge; a cancel error adds nothing
        throw new CheckFailure("tooLarge", `body exceeded ${maxBytes} bytes after ${total} bytes read; reading stopped`);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof CheckFailure) throw e;
    throw new CheckFailure("fetch", `reading the body of ${url} failed: ${describe(e)}`);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readCheck(db: Db, checkKey: string): Promise<CheckRow | null> {
  return db.prepare("SELECT check_id, outcome, content_sha256 FROM source_checks WHERE check_key = ?")
    .bind(checkKey).first<CheckRow>();
}

async function recorded(db: Db, check: CheckRow, sourceId: string, reused: boolean): Promise<CheckResult> {
  const candidate = check.content_sha256 === null ? null : await db.prepare(
    "SELECT candidate_id FROM source_refresh_candidates WHERE source_id = ? AND artifact_sha256 = ?",
  ).bind(sourceId, check.content_sha256).first<{ candidate_id: number }>();
  return {
    status: "recorded", reused, checkId: check.check_id, outcome: check.outcome, contentSha256: check.content_sha256,
    candidateId: check.outcome === "changed" || check.outcome === "needsReview" ? candidate?.candidate_id ?? null : null,
  };
}

/** Returns whether a new object was written. An existing object of another size is corruption: fail closed. */
async function retain(store: RawArtifactStore, sha: string, bytes: Uint8Array): Promise<boolean> {
  const key = rawArtifactKey(sha);
  try {
    const present = await store.head(key);
    if (present) {
      if (present.byteLength !== bytes.byteLength) {
        throw new Error(`object ${key} holds ${present.byteLength} bytes, expected ${bytes.byteLength}`);
      }
      return false;
    }
    await store.put(key, bytes, sha);
    return true;
  } catch (e) {
    throw new CheckFailure("storage", `retaining ${key} failed: ${describe(e)}`);
  }
}

/**
 * Read-only drift probes of a changed file, in a fixed order. The adapter's own parser and mapping are the
 * schema: whatever they refuse or change is drift. Any finding makes the check `needsReview`.
 */
async function probeDrift(
  db: Db,
  adapter: SourceAdapter,
  bytes: Uint8Array,
  baselineRelease: { header_json: string; record_count: number } | null,
  requestUrl: string,
  finalUrl: string,
): Promise<{ header: string[] | null; recordCount: number | null; findings: Finding[] }> {
  const findings: Finding[] = [];
  if (new URL(finalUrl).origin !== new URL(requestUrl).origin) {
    findings.push({ id: "sourceIdentityMismatch", detail: `redirected from ${new URL(requestUrl).origin} to ${new URL(finalUrl).origin}` });
  }

  let parsed: { header: string[]; rows: string[][] };
  try {
    parsed = adapter.parse(bytes);
  } catch (e) {
    findings.push({ id: "parseFailed", detail: describe(e) });
    return { header: null, recordCount: null, findings };
  }

  // The drift baseline is what was reviewed: the current applied release, else the last parsed check.
  const baseline = baselineRelease ?? await db.prepare(
    `SELECT header_json, record_count FROM source_checks WHERE source_id = ? AND header_json IS NOT NULL
     ORDER BY check_id DESC LIMIT 1`,
  ).bind(adapter.registry.sourceId).first<{ header_json: string; record_count: number }>();
  if (baseline) {
    const before = JSON.parse(baseline.header_json) as string[];
    if (JSON.stringify(before) !== JSON.stringify(parsed.header)) {
      findings.push({ id: "headerChanged", detail: `header ${JSON.stringify(before)} -> ${JSON.stringify(parsed.header)}` });
    }
    const decrease = baseline.record_count - parsed.rows.length;
    if (decrease > SOURCE_REFRESH_POLICY.maxRecordDecrease) {
      findings.push({ id: "recordCountDecreased", detail: `${baseline.record_count} -> ${parsed.rows.length} records` });
    }
  }
  if (parsed.rows.length === 0) findings.push({ id: "noRecords", detail: "the file parses to zero records" });

  const unobservable: number[] = [];
  const outside: number[] = [];
  const { extent } = SOURCE_REFRESH_POLICY;
  for (const [i, values] of parsed.rows.entries()) {
    try {
      // Mixed datasets keep every raw row, but only reviewed in-scope rows have a mapping.
      // Keep the predicate inside the try: a scope error is drift, never a silent exclusion.
      if (adapter.includesRecord && !adapter.includesRecord(values)) continue;
      const o = observeSourceRecord(adapter, values);
      if (!(o.latitude >= extent.minLatitude && o.latitude <= extent.maxLatitude
        && o.longitude >= extent.minLongitude && o.longitude <= extent.maxLongitude)) outside.push(i + 1);
    } catch {
      unobservable.push(i + 1);
    }
  }
  if (unobservable.length > 0) {
    findings.push({ id: "recordsUnobservable", detail: `${unobservable.length} record(s) the mapping refuses, first ordinal ${unobservable[0]}` });
  }
  if (outside.length > 0) {
    findings.push({ id: "coordinatesOutsideExtent", detail: `${outside.length} record(s) outside the policy extent, first ordinal ${outside[0]}` });
  }
  return { header: parsed.header, recordCount: parsed.rows.length, findings };
}
