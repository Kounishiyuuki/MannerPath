// Drives the FREE-TIER PROBE's real POST /v1/reports for v1.0 new places without photos
// (docs/release/V1_PHOTO_FREE_NEW_SPOT.md §5): TEST App Attest PKI, one registered key per 10 reports (the per-key
// hourly budget), then N attested `missing` reports with a claim and no photo. Also one idempotent retry (200), one pin
// outside Japan (400) and one report over the hourly budget (429), so the refusal paths are measured too.
// Per-request CPU comes from `wrangler tail`; this script prints statuses and client wall time only.
//
//   PROBE_TOKEN=… npm run free-probe:reports -- --base-url <origin> --reports 20 [--confirm-probe mannerpath-free-tier-probe]
//
// Same refusals as free-tier-probe-run.ts: loopback or the probe's workers.dev only, token from the environment only,
// ≤ 120 reports per run, stop at the first unexpected status. Synthetic content only.
import { registrationClientData, reportClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { REPORT_RATE_LIMITS } from "../src/reports/rate-limit.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { MAX_UPLOADS, checkTarget } from "./free-tier-probe-run.ts";
import { type TestDevice, assert as makeAssertion, attest, testDevice, testPki } from "../test/support/app-attest-fixture.ts";

const APP_ID = "PROBE00000.invalid.mannerpath.free-tier-probe";
const PER_KEY = REPORT_RATE_LIMITS.find((l) => l.kind === "hour")!.max;

async function main(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--base-url", "--reports", "--confirm-probe"].includes(argv[i])) throw new Error(`unknown argument ${argv[i]}`);
    a[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  const token = process.env.PROBE_TOKEN; delete process.env.PROBE_TOKEN;
  if (!token || token.length < 32) throw new Error("set PROBE_TOKEN (≥ 32 chars) in the environment");
  const origin = checkTarget(a["base-url"] ?? "", a["confirm-probe"]).origin;
  const total = Number(a.reports ?? "5");
  if (!Number.isInteger(total) || total < 1 || total > MAX_UPLOADS) throw new Error(`--reports must be 1..${MAX_UPLOADS}`);

  const post = async (path: string, body: unknown) => {
    const started = performance.now();
    const res = await fetch(origin + path, { method: "POST", redirect: "error", body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } });
    return { status: res.status, json: JSON.parse((await res.text()) || "{}") as Record<string, any>, ms: Math.round(performance.now() - started) };
  };
  const expect = (label: string, r: { status: number; json: Record<string, any> }, ...ok: number[]) => {
    if (!ok.includes(r.status)) throw new Error(`${label}: unexpected ${r.status} ${JSON.stringify(r.json).slice(0, 200)} — stopping`);
    return r.json;
  };

  const now = new Date();
  const pki = await testPki(now);
  expect("setup", await post("/probe/setup", { trustAnchor: base64Encode(pki.root) }), 200);
  const register = async (): Promise<TestDevice> => {
    const device = await testDevice();
    const ch = expect("challenge registration", await post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "registration" }), 201).challenge;
    const object = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki, now });
    expect("register", await post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(object) }), 201);
    return device;
  };
  const signed = async (device: TestDevice, idempotencyKey: string, i: number, location?: { latitude: number; longitude: number }) => {
    // Spread synthetic pins over central Tokyo; every field a v1.0 client may send without photos.
    const bytes = utf8(JSON.stringify({ schemaVersion: 3, type: "missing", installId: crypto.randomUUID(), idempotencyKey,
      proposedLocation: location ?? { latitude: 35.68 + (i % 50) * 0.001, longitude: 139.76 + Math.floor(i / 50) * 0.001 },
      observedOn: now.toISOString().slice(0, 10), note: `probe synthetic note ${i}`, acceptedTermsVersion: CURRENT_REPORT_TERMS.version,
      claim: { spotType: "designatedOutdoorArea", accessType: "public", hostType: "station", environment: "outdoor",
        supportsPaper: "yes", supportsHeated: "unknown", hostName: `Probe synthetic place ${i}`, hoursNote: "probe synthetic hours" } }));
    const ch = expect("challenge report", await post("/v1/app-attest/challenges", { schemaVersion: 1, purpose: "report", keyId: device.keyIdBase64 }), 201).challenge;
    const assertion = await makeAssertion(device, await sha256(reportClientData(base64Decode(ch)!, device.keyId, bytes)), { appId: APP_ID });
    return { schemaVersion: 3, payload: base64Encode(bytes), attestation: { keyId: device.keyIdBase64, challenge: ch, assertion: base64Encode(assertion) } };
  };
  const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

  let device = await register(), used = 0, first: { device: TestDevice; key: string } | null = null;
  const wall: number[] = [];
  for (let i = 0; i < total; i++) {
    if (used === PER_KEY) { device = await register(); used = 0; }
    const key = hex();
    const r = await post("/v1/reports", await signed(device, key, i));
    expect(`report ${i + 1}`, r, 201); used++; wall.push(r.ms);
    first ??= { device, key };
  }
  // Refusal and retry paths, each once.
  expect("retry", await post("/v1/reports", await signed(first!.device, first!.key, 0)), 200);
  expect("outside Japan", await post("/v1/reports", await signed(device, hex(), 0, { latitude: 51.5, longitude: -0.12 })), 400);
  while (used < PER_KEY) { expect("fill budget", await post("/v1/reports", await signed(device, hex(), total + used)), 201); used++; }
  expect("over budget", await post("/v1/reports", await signed(device, hex(), 0)), 429);
  wall.sort((x, y) => x - y);
  console.log(`done: ${total} reports (201) + retry 200 + outside Japan 400 + over budget 429; client wall P50 ${wall[Math.floor(wall.length / 2)]} ms (network included)`);
}
if (process.argv[1]?.endsWith("report-intake-probe-run.ts")) main(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
