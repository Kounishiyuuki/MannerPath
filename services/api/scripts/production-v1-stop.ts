// Emergency stop of ALL production report intake, existing App Attest keys included (docs/release/V1_PRODUCTION_INTAKE.md
// §4): deletes the REPORT_APP_ATTEST_APP_ID secret, then runs the `stopped` preflight. No deploy, so it works whatever
// the terms state (#124 open or not) and whatever was deployed last.
//
//   npm run production:v1-stop
//
// It refuses before touching anything unless the config it is about to use is generated fresh from the committed
// wrangler.jsonc and names exactly the production Worker and databases. It is idempotent: when the App ID is already
// absent it deletes nothing and only re-checks. Wrangler asks for confirmation before the delete.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./disposable-env.ts";
import { PRODUCTION_WORKER, productionConfig } from "./production-v1-plan.ts";
import { APP_ID } from "./production-v1-check.ts";

/** Throws unless `generated` targets exactly the committed production Worker and databases. */
export function assertProductionTarget(committed: any, generated: any): void {
  const prod = committed.env?.production;
  if (generated.name !== PRODUCTION_WORKER || prod?.name !== PRODUCTION_WORKER) throw new Error(`target is not ${PRODUCTION_WORKER}`);
  if ("env" in generated) throw new Error("generated config must be flat (no env sections)");
  const ids = (c: any) => (c.d1_databases ?? []).map((d: any) => `${d.binding}=${d.database_id}`).join(",");
  if (ids(generated) !== ids(prod)) throw new Error("generated databases differ from committed env.production");
}

function main() {
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  const path = `${apiDir}/.wrangler/production-v1/worker.jsonc`;
  const committed = parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8"));
  // Generated here, never reused from disk: a stale or hand-edited file must not pick the target.
  const generated = productionConfig(committed, apiDir);
  assertProductionTarget(committed, generated);
  mkdirSync(`${apiDir}/.wrangler/production-v1`, { recursive: true });
  writeFileSync(path, JSON.stringify(generated, null, 2) + "\n");
  assertProductionTarget(committed, JSON.parse(readFileSync(path, "utf8")));

  const run = (args: string[], interactive = false) => execFileSync("npx", ["wrangler", ...args, "-c", path],
    { cwd: apiDir, encoding: "utf8", stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"], timeout: 120_000 });
  const secrets = (JSON.parse(run(["secret", "list", "--format", "json"])) as { name: string }[]).map((s) => s.name);
  if (secrets.includes(APP_ID)) {
    console.log(`deleting ${APP_ID} from ${PRODUCTION_WORKER} (wrangler asks to confirm)`);
    run(["secret", "delete", APP_ID], true);
  } else {
    console.log(`${APP_ID} is already absent from ${PRODUCTION_WORKER}; nothing deleted`);
  }
  try {
    execFileSync("node", ["--experimental-strip-types", "--no-warnings", `${apiDir}/scripts/production-v1-check.ts`, "--stage", "stopped"],
      { cwd: apiDir, stdio: "inherit", timeout: 300_000 });
  } catch {
    // The App ID step above already finished; say so, so a failed re-check is not read as "nothing was stopped".
    throw new Error(`${APP_ID} is absent, but the stopped preflight did not PASS: read its FAIL lines above`);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) {
    console.error(`production:v1-stop refused or failed: ${e instanceof Error ? e.message.split("\n")[0] : "error"}`);
    process.exitCode = 1;
  }
}
