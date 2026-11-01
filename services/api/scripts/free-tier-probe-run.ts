// Drives the FREE-TIER PROBE (docs/release/V1_FREE_TIER_PROBE_RUNBOOK.md): generated TEST App Attest PKI and device,
// one registration, then N signed v3 uploads of client-equivalent JPEGs, then the D1 checks and one retention pass.
// It prints per-request status and wall time; CPU comes from Workers analytics (scripts/free-tier-probe-analytics.ts).
//
//   PROBE_TOKEN=… npm run free-probe:run -- --base-url http://127.0.0.1:8799 --photos <dir> --uploads 10
//   PROBE_TOKEN=… npm run free-probe:run -- --base-url https://mannerpath-free-tier-probe.<sub>.workers.dev \
//       --photos <dir> --uploads 100 --confirm-probe mannerpath-free-tier-probe
//
// Refuses: any host other than loopback or *.workers.dev; a remote host without --confirm-probe; more than 120
// uploads or 100 MB per run; the token on the command line. Stops at the first unexpected status.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registrationClientData } from "../src/attest/binding.ts";
import { base64Decode, base64Encode, sha256, utf8 } from "../src/attest/bytes.ts";
import { sha256Hex } from "../src/db.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { PHOTO_V3_CONTENT_TYPE, PHOTO_V3_IMAGE_MAX_BYTES, encodePhotoBody, photoClientData } from "../src/poc/binary-photo/protocol.ts";
import { DayKeyChain } from "../src/poc/binary-photo/photo-crypto.ts";
import { PROBE_WORKER } from "./free-tier-probe-config.ts";
import { assert as makeAssertion, attest, testDevice, testPki } from "../test/support/app-attest-fixture.ts";

export const MAX_UPLOADS = 120;
export const MAX_RUN_BYTES = 100 * 1024 * 1024;
export const STAGE_REPEATS = 3;
export const STAGE_ORDER = ["read", "split", "jpeg", "sha256", "b64-write", "b64-read", "hex-write", "hex-read", "blob-write", "blob-read"] as const;
const APP_ID = "PROBE00000.invalid.mannerpath.free-tier-probe";

export function checkTarget(baseUrl: string, confirm: string | undefined): URL {
  const url = new URL(baseUrl);
  if (url.pathname !== "/" || url.search || url.username || url.password) throw new Error("--base-url must be an origin only");
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  const probe = url.protocol === "https:" && url.hostname.startsWith(`${PROBE_WORKER}.`) && url.hostname.endsWith(".workers.dev");
  if (!loopback && !probe) throw new Error(`refusing ${url.origin}: only loopback or https://${PROBE_WORKER}.<subdomain>.workers.dev`);
  if (probe && confirm !== PROBE_WORKER) throw new Error(`remote run needs --confirm-probe ${PROBE_WORKER}`);
  return url;
}

function parse(argv: string[]) {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--base-url", "--photos", "--uploads", "--confirm-probe", "--mode", "--d1-checks"].includes(argv[i])) throw new Error(`unknown argument ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return o;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const token = process.env.PROBE_TOKEN; delete process.env.PROBE_TOKEN;
  if (!token || token.length < 32) throw new Error("set PROBE_TOKEN (≥ 32 chars) in the environment");
  const origin = checkTarget(args["base-url"] ?? "", args["confirm-probe"]).origin;
  const uploads = Number(args.uploads ?? "10");
  if (!Number.isInteger(uploads) || uploads < 1 || uploads > MAX_UPLOADS) throw new Error(`--uploads must be 1..${MAX_UPLOADS}`);
  const files = readdirSync(args.photos ?? "").filter((f) => f.endsWith(".jpg")).sort().map((f) => new Uint8Array(readFileSync(join(args.photos!, f))));
  if (!files.length) throw new Error("--photos has no .jpg files");
  for (const f of files) if (f.length > PHOTO_V3_IMAGE_MAX_BYTES) throw new Error(`a photo exceeds the ${PHOTO_V3_IMAGE_MAX_BYTES} B cap`);
  const planned = Array.from({ length: uploads }, (_, i) => files[i % files.length]);
  const total = planned.reduce((n, f) => n + f.length, 0);
  if (total > MAX_RUN_BYTES) throw new Error(`run would send ${total} B > ${MAX_RUN_BYTES}`);

  const call = async (path: string, init: RequestInit = {}) => {
    const started = performance.now();
    const res = await fetch(origin + path, { ...init, redirect: "error", headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
    return { status: res.status, ms: performance.now() - started, body: await res.text() };
  };
  const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const expect = (label: string, r: { status: number; body: string }, ...ok: number[]) => {
    if (!ok.includes(r.status)) throw new Error(`${label}: unexpected ${r.status} ${r.body.slice(0, 200)} — stopping`);
    return JSON.parse(r.body || "{}");
  };

  if ((args.mode ?? "upload") === "seal") {
    // F11: seal each photo with a throwaway epoch public key; nothing is stored.
    const pub = await DayKeyChain.generate(1).publicKeyRaw(1); // throwaway day key; the private side is discarded
    for (let i = 0; i < planned.length; i++) {
      const body = new Uint8Array(32 + planned[i].length); body.set(pub, 0); body.set(planned[i], 32);
      const r = await call("/probe/seal", { method: "POST", body, headers: { "Content-Type": "application/octet-stream" } });
      expect(`seal ${i + 1}`, r, 200);
      console.log(`seal ${i + 1}/${planned.length} ${planned[i].length} B → ${r.status} (${r.ms.toFixed(0)} ms wall)`);
    }
    return;
  }
  if (args.mode === "stages") {
    // §10: each upload stage alone, on the first --photos file, STAGE_REPEATS times; cheap stages first. Rows are
    // replaced in probe_blob_checks, so storage stays at one photo. Stops at the first non-200 (e.g. exceededCpu).
    const image = files[0], frame = encodePhotoBody({ schemaVersion: 3, payload: "e30=", attestation: { keyId: "", challenge: "", assertion: "" } }, image);
    for (const stage of STAGE_ORDER) for (let i = 0; i < STAGE_REPEATS; i++) {
      const r = await call(`/probe/stage/${stage}`, { method: "POST", body: stage === "split" ? frame : image, headers: { "Content-Type": "application/octet-stream" } });
      expect(`stage ${stage}`, r, 200);
      console.log(`stage ${stage} ${i + 1}/${STAGE_REPEATS} ${image.length} B → ${r.status} ${r.body.slice(0, 120)}`);
    }
    return;
  }
  if ((args.mode ?? "upload") !== "upload") throw new Error("--mode must be upload, seal or stages");
  const pki = await testPki(), device = await testDevice();
  expect("setup", await post("/probe/setup", { trustAnchor: base64Encode(pki.root) }), 200);
  const challenge = async (purpose: "registration" | "report") => expect(`challenge ${purpose}`,
    await post("/v1/app-attest/challenges", { schemaVersion: 1, purpose, ...(purpose === "report" ? { keyId: device.keyIdBase64 } : {}) }), 201).challenge as string;
  const ch = await challenge("registration");
  const object = await attest(device, await sha256(registrationClientData(base64Decode(ch)!, device.keyId)), { appId: APP_ID, pki });
  const registered = await post("/v1/app-attest/keys", { schemaVersion: 1, keyId: device.keyIdBase64, challenge: ch, attestationObject: base64Encode(object) });
  expect("register", registered, 201);
  console.log(`register 201 (${registered.ms.toFixed(0)} ms wall)`);

  const lines: string[] = [];
  for (let i = 0; i < planned.length; i++) {
    const image = planned[i];
    const reportId = expect("report", await post("/probe/reports", { keyId: device.keyIdBase64 }), 201).reportId as string;
    const payload = utf8(JSON.stringify({ schemaVersion: 3, kind: "photo", reportId, idempotencyKey: crypto.randomUUID(),
      acceptedTermsVersion: CURRENT_REPORT_TERMS.version, mediaType: "image/jpeg", byteLength: image.length, sha256: await sha256Hex(image) }));
    const rc = await challenge("report");
    const assertion = await makeAssertion(device, await sha256(photoClientData(base64Decode(rc)!, device.keyId, payload)), { appId: APP_ID });
    const body = encodePhotoBody({ schemaVersion: 3, payload: base64Encode(payload), attestation: { keyId: device.keyIdBase64, challenge: rc, assertion: base64Encode(assertion) } }, image);
    const r = await call(`/v3/reports/${reportId}/photos`, { method: "POST", body, headers: { "Content-Type": PHOTO_V3_CONTENT_TYPE } });
    expect(`upload ${i + 1}`, r, 201);
    lines.push(`upload ${i + 1}/${planned.length} ${image.length} B → ${r.status} (${r.ms.toFixed(0)} ms wall)`);
  }
  console.log(lines.join("\n"));
  console.log("usage", (await call("/probe/usage")).body);
  // `--d1-checks off` for small per-size upload runs: the checks alone cost ~1.1 s CPU (runbook §9) and are not re-measured.
  if (args["d1-checks"] !== "off") console.log("d1-checks", JSON.stringify(expect("d1-checks", await post("/probe/d1-checks", {}), 200), null, 1));
  console.log("retention", (await post("/probe/retention", {})).body);
  console.log(`done: ${planned.length} uploads, ${total} B sent. CPU: run scripts/free-tier-probe-analytics.ts for this time window.`);
}
if (process.argv[1]?.endsWith("free-tier-probe-run.ts")) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
