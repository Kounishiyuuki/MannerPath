// LOCAL ONLY automation/status oracle. No remote target, admin endpoint or private output.
import { getPlatformProxy } from "wrangler";
import type { Db } from "../src/db.ts";
import { runRetentionMaintenance } from "../src/reports/retention-automation.ts";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "status";
  if (args.length > 1 || !["status", "run"].includes(command)) throw new Error("Invalid retention command");
  const local = await getPlatformProxy<{ REPORTS_DB?: Db }>({ configPath: new URL("../wrangler.jsonc", import.meta.url).pathname, remoteBindings: false, envFiles: [] });
  try {
    if (!local.env.REPORTS_DB) throw new Error("Report store unavailable");
    const result = await runRetentionMaintenance(local.env.REPORTS_DB, { now: new Date(), mode: command === "run" ? "cleanup" : "monitor" });
    console.log(JSON.stringify(result));
    if (result.outcome !== "complete") process.exitCode = 1;
  } finally {
    await local.dispose();
  }
}
main().catch(() => {
  process.stdout.write(JSON.stringify({ event: "reportRetention", outcome: "failed", reason: "unavailable" }) + "\n", () => process.exit(1));
});
