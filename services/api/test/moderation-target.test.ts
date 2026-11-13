import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonc } from "../scripts/disposable-env.ts";
import { moderationTarget, REPORT_STORE_NAMES } from "../src/reports/moderation-target.ts";
import { parseAdminArguments } from "../scripts/report-admin.ts";
import { parseBulkArguments } from "../scripts/bulk-report-reject.ts";

const committed = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const tty = { interactive: true, ci: false };
const id = (environment: "staging" | "production", binding = "REPORTS_DB") =>
  committed.env[environment].d1_databases.find((d: { binding: string }) => d.binding === binding).database_id;
const remote = (environment: "staging" | "production", databaseId = id(environment)) => [
  "--remote", "--env", environment, "--database-id", databaseId,
  ...(environment === "production" ? ["--confirm-production", REPORT_STORE_NAMES.production] : []),
];

test("each remote environment accepts only its committed REPORTS_DB identity", () => {
  for (const env of ["staging", "production"] as const) {
    const args = remote(env);
    assert.deepEqual(moderationTarget(args, tty, committed), { ok: true, rest: [], target: {
      kind: "remote", environment: env, databaseName: REPORT_STORE_NAMES[env], databaseId: id(env),
    } });
    for (const wrong of [id(env === "staging" ? "production" : "staging"), id("staging", "DB"), id("production", "DB"),
      "11111111-1111-4111-8111-111111111111"]) {
      const result = moderationTarget(remote(env, wrong), tty, committed);
      assert.equal(result.ok, false);
      assert.match((result as { error: string }).error, /identity does not match/);
      assert.ok(!JSON.stringify(result).includes(wrong), "refusal does not echo a supplied database identifier");
    }
  }
});

test("unknown, duplicate, cross-stream or malformed inventories cannot authorize a remote connection", () => {
  for (const inventory of [undefined, null, {}, { env: {} }]) {
    assert.equal(moderationTarget(remote("staging"), tty, inventory).ok, false);
  }
  for (const mutate of [
    (c: any) => { c.env.staging.d1_databases[1].database_id = id("production"); },
    (c: any) => { c.env.staging.d1_databases[1].database_id = id("production", "DB"); },
    (c: any) => { c.env.staging.d1_databases[1].database_id = "00000000-0000-0000-0000-000000000001"; },
    (c: any) => { c.env.staging.d1_databases[1].database_name = REPORT_STORE_NAMES.production; },
    (c: any) => { c.env.staging.d1_databases[1].migrations_dir = "migrations"; },
    (c: any) => { c.env.staging.d1_databases.push(c.env.staging.d1_databases[1]); },
    (c: any) => { c.env.staging.d1_databases.push(null); },
    (c: any) => { c.env.production = null; },
  ]) {
    const inventory = structuredClone(committed); mutate(inventory);
    assert.equal(moderationTarget(remote("staging"), tty, inventory).ok, false);
  }
});

test("config matching does not waive terminal, CI, explicit remote or production confirmation gates", () => {
  const production = remote("production");
  assert.equal(moderationTarget(production.slice(0, -2), tty, committed).ok, false);
  assert.equal(moderationTarget(production.slice(1), tty, committed).ok, false);
  for (const facts of [{ interactive: false, ci: false }, { interactive: true, ci: true }]) {
    assert.equal(moderationTarget(production, facts, committed).ok, false);
  }
  assert.deepEqual(moderationTarget(["list"], { interactive: false, ci: true }), {
    ok: true, target: { kind: "local" }, rest: ["list"],
  }, "local operation needs neither a remote inventory nor a terminal");
});

test("admin and bulk parsers reject a production ID labelled staging before connections", () => {
  const mistaken = remote("staging", id("production"));
  assert.throws(() => parseAdminArguments(mistaken, tty, committed), /identity does not match/);
  assert.throws(() => parseBulkArguments(["--ids-file", "ids.json", "--reason", "abuse", "--decided-by", "operator",
    "--out", "plan.json", ...mistaken], tty, committed));
  assert.equal(parseAdminArguments(remote("staging"), tty, committed).target.kind, "remote");
});
