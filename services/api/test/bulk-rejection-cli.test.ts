import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseBulkArguments, readPrivateInput } from "../scripts/bulk-report-reject.ts";
const facts = { interactive: true, ci: false };
const base = ["--ids-file", "ids.json", "--reason", "abuse", "--decided-by", "maintainer", "--out", "plan.json"];
test("bulk CLI defaults to dry-run and rejects empty/unknown/duplicate selectors and confirmations", () => {
  assert.equal(parseBulkArguments(base, facts).mode, "plan");
  for (const argv of [[], ["apply"], [...base, "--reason", "abuse"], [...base, "--max-count", "41"],
    [...base, "--unexpected", "value"], ["--from", "2026-10-13T00:00:00Z", "--out", "plan"],
    [...base, "--decided-by", "person@example.test"], [...base, "--pepper-file", "secret"]]) {
    assert.throws(() => parseBulkArguments(argv, facts));
  }
  assert.equal(parseBulkArguments(["apply", "--plan", "plan.json", "--confirm", "a".repeat(64)], facts).mode, "apply");
});
test("remote bulk moderation needs existing explicit environment/identity/TTY guards", () => {
  const remote = [...base, "--remote", "--env", "production", "--database-id", "12345678-1234-1234-1234-123456789abc",
    "--confirm-production", "mannerpath-production-reports"];
  assert.equal(parseBulkArguments(remote, facts).target.kind, "remote");
  for (const f of [{ interactive: false, ci: false }, { interactive: true, ci: true }]) assert.throws(() => parseBulkArguments(remote, f));
  assert.throws(() => parseBulkArguments([...base, "--remote", "--env", "production"], facts));
  assert.throws(() => parseBulkArguments([...base, "--env", "staging"], facts));
  assert.throws(() => parseBulkArguments([...remote, "--persist-to", "local-state"], facts));
});
test("private selector input refuses symlinks, world readable files, malformed UTF8 and overflow", () => {
  const dir = mkdtempSync(join(tmpdir(), "bulk-cli-"));
  try {
    const file = join(dir, "private-input"); writeFileSync(file, "sentinel-private-value", { mode: 0o600 });
    assert.equal(readPrivateInput(file, 1024), "sentinel-private-value");
    assert.throws(() => readPrivateInput(file, 1), { message: "unsafeInputFile" });
    const link = join(dir, "link"); symlinkSync(file, link);
    assert.throws(() => readPrivateInput(link, 1024), { message: "unsafeInputFile" });
    chmodSync(file, 0o644);
    assert.throws(() => readPrivateInput(file, 1024), { message: "unsafeInputFile" });
    chmodSync(file, 0o600); writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => readPrivateInput(file, 1024), { message: "unsafeInputFile" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("CLI refusal never echoes arbitrary arguments or errors and occurs before connecting", () => {
  const secret = "s".repeat(32);
  const out = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings",
    new URL("../scripts/bulk-report-reject.ts", import.meta.url).pathname, "--" + secret], { encoding: "utf8" });
  assert.equal(out.status, 2);
  assert.equal(out.stdout, ""); assert.equal(out.stderr.trim(), "refused: invalidArguments");
  assert.equal(out.stderr.includes(secret), false);
});

test("real local CLI uses migrated Wrangler state for dry-run, atomic apply and replay", { timeout: 90_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "bulk-cli-rpc-"));
  const api = new URL("../", import.meta.url).pathname;
  const state = join(dir, "state"), ids = join(dir, "ids.json"), plan = join(dir, "plan.json");
  const env = { ...process.env, CI: "true", XDG_CONFIG_HOME: join(dir, "config"), WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG: "error", WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" };
  const run = (argv: string[]) => spawnSync(process.execPath, argv, { env, cwd: api, encoding: "utf8", timeout: 30_000, maxBuffer: 2_000_000 });
  try {
    const migrated = run([join(api, "node_modules/wrangler/bin/wrangler.js"), "d1", "migrations", "apply", "REPORTS_DB",
      "--config", join(api, "wrangler.jsonc"), "--local", "--persist-to", state]);
    assert.equal(migrated.status, 0, "isolated local migration must succeed");
    const seed = join(dir, "seed.mts");
    writeFileSync(seed, `import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {createReport} from ${JSON.stringify(new URL("../src/reports/create.ts", import.meta.url).href)};
const require=createRequire(${JSON.stringify(join(api, "package.json"))});
const {getPlatformProxy}=require('wrangler');
const p=await getPlatformProxy({configPath:${JSON.stringify(join(api, "wrangler.jsonc"))},remoteBindings:false,persist:{path:${JSON.stringify(join(state, "v3"))}}});
try {
 if(process.argv[2]==='seed') {
  const ids=[];
  for(let i=0;i<2;i++) ids.push((await createReport(p.env.REPORTS_DB,{schemaVersion:1,type:'exists',spotId:'sp_01V64NN31G72E5KJJ5W22W1A1J',installId:'8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f',note:'BULK_RPC_PRIVATE_NOTE_SENTINEL'},{now:new Date(),attestationStatus:'notProvided',submitterHash:'a'.repeat(64)})).reportId);
  writeFileSync(${JSON.stringify(ids)},JSON.stringify(ids),{mode:0o600});
 } else {
  const q=async(sql)=>(await p.env.REPORTS_DB.prepare(sql).first()).n;
  console.log(JSON.stringify({rejected:await q("SELECT count(*) n FROM report_moderation WHERE state='rejected'"),operations:await q('SELECT count(*) n FROM report_bulk_rejections'),targets:await q('SELECT count(*) n FROM report_bulk_rejection_targets'),completed:await q('SELECT count(*) n FROM report_bulk_rejection_completions')}));
 }
} finally {await p.dispose();}`, { mode: 0o600 });
    assert.equal(run(["--experimental-strip-types", "--no-warnings", seed, "seed"]).status, 0);
    const cli = new URL("../scripts/bulk-report-reject.ts", import.meta.url).pathname;
    const invoke = (args: string[]) => run(["--experimental-strip-types", "--no-warnings", cli, ...args]);
    const preview = invoke(["--ids-file", ids, "--reason", "abuse", "--decided-by", "maintainer", "--out", plan, "--persist-to", state]);
    assert.equal(preview.status, 0); assert.equal(preview.stderr, "");
    const summary = JSON.parse(preview.stdout);
    assert.equal(summary.mode, "dryRun"); assert.equal(summary.count, 2);
    const privatePlan = readPrivateInput(plan, 80_000);
    assert.equal(privatePlan.includes("BULK_RPC_PRIVATE_NOTE_SENTINEL"), false);
    assert.equal(privatePlan.includes("a".repeat(64)), false);
    const applied = invoke(["apply", "--plan", plan, "--confirm", summary.digest, "--persist-to", state]);
    assert.equal(applied.status, 0); assert.equal(applied.stderr, "");
    assert.equal(JSON.parse(applied.stdout).status, "applied");
    const repeated = invoke(["apply", "--plan", plan, "--confirm", summary.digest, "--persist-to", state]);
    assert.equal(repeated.status, 0); assert.equal(JSON.parse(repeated.stdout).status, "alreadyApplied");
    const changed = invoke(["apply", "--plan", plan, "--confirm", summary.digest, "--persist-to", join(dir, "another-store")]);
    assert.equal(changed.status, 2); assert.equal(changed.stderr.trim(), "refused: targetMismatch");
    const verified = run(["--experimental-strip-types", "--no-warnings", seed, "verify"]);
    assert.equal(verified.status, 0);
    assert.deepEqual(JSON.parse(verified.stdout), { rejected: 2, operations: 1, targets: 2, completed: 1 });
    for (const output of [preview, applied, repeated, changed, verified]) {
      assert.equal((output.stdout + output.stderr).includes("BULK_RPC_PRIVATE_NOTE_SENTINEL"), false);
      assert.equal((output.stdout + output.stderr).includes("a".repeat(64)), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
