import { test } from "node:test";
import assert from "node:assert/strict";
import { smokeTarget, stagingSmoke } from "../scripts/staging-security-smoke.ts";
import { configBody } from "../src/config/dto.ts";

test("smoke targets are loopback by default or explicitly confirmed staging, never production", () => {
  assert.deepEqual(smokeTarget([]), { origin: "http://127.0.0.1:8787", remote: false, expect: "unavailable" });
  const flags = ["--base-url", "https://mannerpath-api-staging.example.workers.dev", "--confirm-staging", "mannerpath-api-staging"];
  assert.equal(smokeTarget(flags).remote, true);
  for (const args of [flags.slice(0, 2), [...flags, "--remote", "true"], [...flags, "--expect-reports", "legacy"],
    ["--base-url", "https://mannerpath-api-production.example.workers.dev", "--confirm-staging", "mannerpath-api-staging"],
    ["--base-url", "http://mannerpath-api-staging.example.workers.dev", "--confirm-staging", "mannerpath-api-staging"],
    ["--base-url", "https://user:password@mannerpath-api-staging.example.workers.dev", "--confirm-staging", "mannerpath-api-staging"],
    ["--base-url", "http://127.0.0.1:8787/path"], ["--base-url", "http://127.0.0.1:8787?token=x"],
    ["--base-url", "http://127.0.0.1:8787", "--base-url", "http://localhost:8787"]]) assert.throws(() => smokeTarget(args));
});

const ready = { schemaVersion: 1, completed: true, state: "completed" };
const closed = configBody({ REPORT_ATTESTATION: "required" });
function response(body: unknown, status = 200, policy = "public, no-cache") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Cache-Control": policy } });
}
const remote = () => smokeTarget(["--base-url", "https://mannerpath-api-staging.example.workers.dev", "--confirm-staging", "mannerpath-api-staging"]);
function transport(replies: Response[], requests: { url: string; options: RequestInit | undefined }[]) {
  return (async (url, options) => { requests.push({ url: String(url), options }); return replies.shift()!; }) as typeof fetch;
}

test("closed smoke uses GET only, rejects redirects and reports no private response fields", async () => {
  const requests: { url: string; options: RequestInit | undefined }[] = [];
  const result = await stagingSmoke(remote(), transport([response(ready, 200, "no-store"), response(closed)], requests));
  assert.equal(result.result, "PASS"); assert.equal(result.writePath, "UNVERIFIED");
  assert.deepEqual(requests.map(r => new URL(r.url).pathname), ["/v1/readiness", "/v1/config"]);
  for (const { options } of requests) {
    assert.equal(options?.method, "GET"); assert.equal(options?.redirect, "error");
    assert.equal(options?.body, undefined); assert.ok(options?.signal);
  }
  assert.equal(JSON.stringify(result).includes("termsVersion"), false);
});

test("remote incomplete promotion stops before config, local pipeline is allowed only locally", async () => {
  const requests: { url: string; options: RequestInit | undefined }[] = [];
  const incomplete = { schemaVersion: 1, completed: false, state: "localPipeline" };
  await assert.rejects(stagingSmoke(remote(), transport([response(incomplete, 503, "no-store")], requests)));
  assert.equal(requests.length, 1);
  assert.equal((await stagingSmoke(smokeTarget([]), transport([response(incomplete, 503, "no-store"), response(closed)], []))).result, "PASS");
});

test("v3 requires an explicit available App Attest-only 3..3 config; old schema and photos refuse", async () => {
  const open = { ...closed, schemaVersions: { ...closed.schemaVersions, report: 3 },
    minimumSupportedSchemaVersions: { ...closed.minimumSupportedSchemaVersions, report: 3 },
    reports: { ...closed.reports, available: true, attestation: "appAttest" } };
  const target = { ...remote(), expect: "v3" as const };
  assert.equal((await stagingSmoke(target, transport([response(ready, 200, "no-store"), response(open)], []))).result, "PASS");
  for (const body of [closed, { ...open, schemaVersions: { ...open.schemaVersions, report: 2 } },
    { ...open, reports: { ...open.reports, photoEvidenceEnabled: true } },
    { ...open, reports: { ...open.reports, attestation: "none" } }]) {
    await assert.rejects(stagingSmoke(target, transport([response(ready, 200, "no-store"), response(body)], [])));
  }
  await assert.rejects(stagingSmoke(remote(), transport([response(ready, 200, "no-store"), response(open)], [])));
});

test("bounded responses refuse advertised overflow and streaming overflow, cancelling the body", async () => {
  for (const advertised of [true, false]) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel() { cancelled = true; },
    });
    const headers: Record<string, string> = { "x-content-type-options": "nosniff" };
    if (advertised) headers["content-length"] = "8193";
    await assert.rejects(stagingSmoke(remote(), transport([new Response(stream, { headers })], [])));
    assert.equal(cancelled, true);
  }
});

test("remote closed config cannot advertise an unattested fallback", async () => {
  await assert.rejects(stagingSmoke(remote(), transport([response(ready, 200, "no-store"),
    response({ ...closed, reports: { ...closed.reports, attestation: "none" } })], [])));
});

test("malformed JSON, missing nosniff and wrong cache policy never pass", async () => {
  for (const res of [new Response("{broken", { headers: { "x-content-type-options": "nosniff" } }),
    new Response(JSON.stringify(ready)), response(ready, 200, "public, max-age=60")]) {
    await assert.rejects(stagingSmoke(remote(), transport([res], [])));
  }
});
