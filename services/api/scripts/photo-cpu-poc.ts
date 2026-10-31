// LOCAL PoC benchmark for docs/release/V1_FREE_TIER_ARCHITECTURE.md. No network, no Cloudflare, no real keys.
//   node --experimental-strip-types --experimental-sqlite --experimental-test-module-mocks --no-warnings \
//     scripts/photo-cpu-poc.ts <dir-of-client-jpegs> [current|B|B-fast-base64]
// Modes swap modules IN THIS PROCESS ONLY (node:test module mocks); no repository code path changes:
//   current          the shipped route: decode + re-encode to PNG
//   B                sanitizer replaced by validateJpegStructure + SHA-256 (the client's JPEG is stored as-is)
//   B-fast-base64    B, plus base64Decode replaced by an equally strict atob decoder without the JS re-encode check
// Runs the real photo route in-process (node:sqlite stands in for D1, so database CPU is OVER-counted versus D1,
// where queries run outside the isolate) and measures process CPU per request. Node is not workerd: treat every
// figure as indicative, and confirm on a deployed Worker before relying on it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "node:test";
import { validateJpegStructure } from "../src/reports/jpeg-structure.ts";

const mode = process.argv[3] ?? "current";
if (!["current", "B", "B-fast-base64"].includes(mode)) throw new Error(`unknown mode ${mode}`);
if (mode !== "current") {
  const actual = await import("../src/reports/photo-sanitizer.ts");
  mock.module(new URL("../src/reports/photo-sanitizer.ts", import.meta.url).href, { namedExports: { ...actual,
    async sanitizeEvidencePhoto(input: Uint8Array) {
      const { width, height } = validateJpegStructure(input);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
      // media_type is CHECKed to image/png by migration 0003; a real option B needs an additive migration for image/jpeg.
      return { bytes: input, contentSha256: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""), mediaType: "image/png", byteLength: input.length, width, height };
    } } });
}
if (mode === "B-fast-base64") {
  const actual = await import("../src/attest/bytes.ts");
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  mock.module(new URL("../src/attest/bytes.ts", import.meta.url).href, { namedExports: { ...actual,
    // Same acceptance as the shipped decoder (canonical, padded, no whitespace) without the O(n) JS re-encode:
    // atob rejects characters outside the alphabet; the length equation proves it stripped no whitespace; the pad
    // bits check rules out a second spelling of the same bytes.
    base64Decode(text: string) {
      if (text.length % 4 !== 0) return null;
      let binary: string;
      try { binary = atob(text); } catch { return null; }
      const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
      if (binary.length !== (text.length / 4) * 3 - pad) return null;
      if (pad && (ALPHABET.indexOf(text[text.length - pad - 1]) & (pad === 2 ? 0x0f : 0x03)) !== 0) return null;
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } } });
}
const { REGISTRATION_TEST_ENV } = await import("../test/support/registration-env.ts");
const { createApp } = await import("../src/app.ts");
const { registrationClientData, reportClientData } = await import("../src/attest/binding.ts");
const { base64Decode, base64Encode, sha256, utf8 } = await import("../src/attest/bytes.ts");
const { attestedSubmitter, createReport, submitterHash } = await import("../src/reports/create.ts");
const { CURRENT_REPORT_TERMS } = await import("../src/reports/terms.ts");
const { MemoryEvidencePhotoStorage } = await import("../src/reports/photo-storage.ts");
const { sanitizeEvidencePhoto } = await import("../src/reports/photo-sanitizer.ts");
const { assert: makeAssertion, attest, testDevice, testPki } = await import("../test/support/app-attest-fixture.ts");
const { reportsD1, SqliteD1 } = await import("../test/support/sqlite-d1.ts");

const APP_ID = "ABCDE12345.com.example.mannerpath";
const ENV = { ...REGISTRATION_TEST_ENV, REPORT_ATTESTATION: "required", REPORT_APP_ATTEST_APP_ID: APP_ID,
  REPORT_APP_ATTEST_ENVIRONMENT: "production", REPORT_APP_ATTEST_BUNDLE_VERSIONS: "41,42", REPORT_SUBMITTER_PEPPER: "x".repeat(32) };

async function cpu<T>(fn: () => Promise<T> | T): Promise<[number, T]> {
  const start = process.cpuUsage(); const value = await fn(); const used = process.cpuUsage(start);
  return [(used.user + used.system) / 1000, value];
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (xs: number[]) => `median ${median(xs).toFixed(1)} ms (min ${Math.min(...xs).toFixed(1)}, max ${Math.max(...xs).toFixed(1)})`;

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: photo-cpu-poc.ts <dir-of-client-jpegs>");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  const db = reportsD1(), storage = new MemoryEvidencePhotoStorage(), pki = await testPki(), now = new Date();
  const app = createApp({ now: () => now, appAttestTrustAnchor: pki.root, photoEvidence: { enabled: true, storage, photoTermsCovered: () => true } });
  // One canonical DB for the whole run: constructing SqliteD1 applies every migration, which is harness cost.
  const dataDb = new SqliteD1();
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    { DB: dataDb, REPORTS_DB: db, ...ENV });
  const device = await testDevice();
  const challenge = async (purpose: "registration" | "report") => ((await (await post("/v1/app-attest/challenges",
    { schemaVersion: 1, purpose, ...(purpose === "report" ? { keyId: device.keyIdBase64 } : {}) })).json()) as { challenge: string }).challenge;

  const ch = await challenge("registration");
  const object = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki });
  const [registerMs, registered] = await cpu(() => post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(object) }));
  console.log(`register (attestation verify, test PKI) status ${registered.status}: ${registerMs.toFixed(1)} ms`);

  // Baselines: routes with no image, to separate fixed per-request cost from image cost.
  const baseline = async (label: string, fn: () => Promise<Response>, expect: number) => {
    const xs: number[] = [];
    for (let run = 0; run < 8; run++) { const [ms, res] = await cpu(fn); if (res.status !== expect) throw new Error(`${label}: ${res.status}`); if (run > 0) xs.push(ms); }
    console.log(`${label}: ${fmt(xs)}`);
  };
  await baseline("GET /v1/config", () => app.request("/v1/config", {}, { DB: dataDb, REPORTS_DB: db, ...ENV }), 200);
  const textReport: number[] = [];
  for (let run = 0; run < 8; run++) {
    const payload = utf8(JSON.stringify({ schemaVersion: 3, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: crypto.randomUUID(),
      idempotencyKey: Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("") }));
    const rc = await challenge("report");
    const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(rc)!, device.keyId, payload)), { appId: APP_ID });
    const body = { schemaVersion: 3, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: rc, assertion: base64Encode(assertion) } };
    const [ms, res] = await cpu(() => post("/v1/reports", body));
    if (res.status !== 201) throw new Error(`text report: ${res.status} ${await res.text()}`);
    if (run > 0) textReport.push(ms);
  }
  console.log(`POST /v1/reports (text-only, attested): ${fmt(textReport)}`);

  const hash = await submitterHash(attestedSubmitter(device.keyIdBase64), ENV.REPORT_SUBMITTER_PEPPER);
  console.log(`mode ${mode}`);
  console.log("file | bytes | WxH | route | sanitizer in this mode | structure check only");
  for (const file of files) {
    const jpeg = new Uint8Array(readFileSync(join(dir, file)));
    const route: number[] = [], sanitize: number[] = [], structure: number[] = [];
    let size = "";
    for (let run = 0; run < 7; run++) {
      // A fresh report per run so the attachment cap (3) and idempotency never short-circuit the route.
      const report = await createReport(db, { schemaVersion: 2, type: "exists", spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J", installId: crypto.randomUUID(),
        acceptedTermsVersion: CURRENT_REPORT_TERMS.version }, { now, attestationStatus: "verified", submitterHash: hash });
      const input = { schemaVersion: 2, reportId: report.reportId, idempotencyKey: crypto.randomUUID(), acceptedTermsVersion: CURRENT_REPORT_TERMS.version,
        mediaType: "image/jpeg", image: base64Encode(jpeg) };
      const payload = utf8(JSON.stringify(input)), rc = await challenge("report");
      const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(rc)!, device.keyId, payload)), { appId: APP_ID });
      const body = { schemaVersion: 2, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: rc, assertion: base64Encode(assertion) } };
      const [ms, response] = await cpu(() => post(`/v1/reports/${report.reportId}/photos`, body));
      if (response.status !== 201) throw new Error(`${file}: route answered ${response.status} ${await response.text()}`);
      if (run > 0) route.push(ms); // first run warms the JIT
      const [s] = await cpu(() => sanitizeEvidencePhoto(jpeg, "image/jpeg")); if (run > 0) sanitize.push(s);
      const [v, dims] = await cpu(() => validateJpegStructure(jpeg)); if (run > 0) structure.push(v);
      size = `${dims.width}x${dims.height}`;
    }
    console.log(`${file} | ${jpeg.length} | ${size} | ${fmt(route)} | ${fmt(sanitize)} | ${fmt(structure)}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
