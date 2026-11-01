// Drives the A1 probe (docs/release/V1_KV_PHOTO_A1_POC.md): TEST App Attest PKI and device, one registration, then N
// photos as ① intent + ② upload, then the KV deletion facts. Per-request CPU comes from `wrangler tail`.
//
//   PROBE_TOKEN=… npm run kv-probe:run -- --base-url <origin> --photos <dir> --uploads 5 [--confirm-probe mannerpath-free-tier-probe]
//
// Same refusals as free-tier-probe-run.ts: loopback or the probe's workers.dev only, ≤ 120 uploads and ≤ 100 MB per run,
// token from the environment only, stop at the first unexpected status.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registrationClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { sha256Hex } from "../src/db.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { PHOTO_V3_IMAGE_MAX_BYTES } from "../src/poc/binary-photo/protocol.ts";
import { photoIntentClientData } from "../src/poc/kv-photo/two-step.ts";
import { MAX_RUN_BYTES, MAX_UPLOADS, checkTarget } from "./free-tier-probe-run.ts";
import { assert as makeAssertion, attest, testDevice, testPki } from "../test/support/app-attest-fixture.ts";

const APP_ID = "PROBE00000.invalid.mannerpath.free-tier-probe";

async function main(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--base-url", "--photos", "--uploads", "--confirm-probe", "--delete-check"].includes(argv[i])) throw new Error(`unknown argument ${argv[i]}`);
    a[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  const token = process.env.PROBE_TOKEN; delete process.env.PROBE_TOKEN;
  if (!token || token.length < 32) throw new Error("set PROBE_TOKEN (≥ 32 chars) in the environment");
  const origin = checkTarget(a["base-url"] ?? "", a["confirm-probe"]).origin;
  const uploads = Number(a.uploads ?? "5");
  if (!Number.isInteger(uploads) || uploads < 1 || uploads > MAX_UPLOADS) throw new Error(`--uploads must be 1..${MAX_UPLOADS}`);
  const files = readdirSync(a.photos ?? "").filter((f) => f.endsWith(".jpg")).sort().map((f) => new Uint8Array(readFileSync(join(a.photos!, f))));
  if (!files.length) throw new Error("--photos has no .jpg files");
  for (const f of files) if (f.length > PHOTO_V3_IMAGE_MAX_BYTES) throw new Error(`a photo exceeds the ${PHOTO_V3_IMAGE_MAX_BYTES} B cap`);
  const planned = Array.from({ length: uploads }, (_, i) => files[i % files.length]);
  const total = planned.reduce((n, f) => n + f.length, 0);
  if (total > MAX_RUN_BYTES) throw new Error(`run would send ${total} B > ${MAX_RUN_BYTES}`);

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(origin + path, { ...init, redirect: "error", headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.text() };
  };
  const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const expect = (label: string, r: { status: number; body: string }, ...ok: number[]) => {
    if (!ok.includes(r.status)) throw new Error(`${label}: unexpected ${r.status} ${r.body.slice(0, 200)} — stopping`);
    return JSON.parse(r.body || "{}");
  };

  const pki = await testPki(), device = await testDevice();
  expect("setup", await post("/probe/setup", { trustAnchor: base64Encode(pki.root) }), 200);
  const challenge = async (purpose: "registration" | "report") => expect(`challenge ${purpose}`,
    await post("/v1/app-attest/challenges", { schemaVersion: 1, purpose, ...(purpose === "report" ? { keyId: device.keyIdBase64 } : {}) }), 201).challenge as string;
  const ch = await challenge("registration");
  const object = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki });
  expect("register", await post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(object) }), 201);

  for (let i = 0; i < planned.length; i++) {
    const image = planned[i];
    const reportId = expect("report", await post("/probe/reports", { keyId: device.keyIdBase64 }), 201).reportId as string;
    const payload = utf8(JSON.stringify({ schemaVersion: 4, kind: "photoIntent", reportId, idempotencyKey: crypto.randomUUID(),
      acceptedTermsVersion: CURRENT_REPORT_TERMS.version, mediaType: "image/jpeg", byteLength: image.length, sha256: await sha256Hex(image) }));
    const rc = await challenge("report");
    const assertion = await makeAssertion(device, await sha256(photoIntentClientData(base64Decode(rc)!, device.keyId, payload)), { appId: APP_ID });
    const ticket = expect(`intent ${i + 1}`, await post(`/v4/reports/${reportId}/photo-intents`,
      { schemaVersion: 4, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: rc, assertion: base64Encode(assertion) } }), 201).ticket as string;
    expect(`upload ${i + 1}`, await call(`/v4/photo-uploads/${ticket}`, { method: "PUT", body: image, headers: { "Content-Type": "image/jpeg" } }), 201);
    if (i === 0) expect("replay", await call(`/v4/photo-uploads/${ticket}`, { method: "PUT", body: image, headers: { "Content-Type": "image/jpeg" } }), 409);
    console.log(`photo ${i + 1}/${planned.length} ${image.length} B → intent 201, upload 201`);
  }
  console.log("kv-usage", (await call("/probe/kv-usage")).body);
  console.log("kv-check", (await call(`/probe/kv-check${a["delete-check"] === "on" ? "?delete=1" : ""}`, { method: "POST" })).body);
  console.log(`done: ${planned.length} photos, ${total} B sent.`);
}
if (process.argv[1]?.endsWith("kv-photo-probe-run.ts")) main(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
