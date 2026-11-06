// LOCAL ONLY: no remote binding, target flag, write operation or private value output.
import { getPlatformProxy } from "wrangler";
import type { Db } from "../src/db.ts";
import { reportPrivacyInventory } from "../src/reports/privacy-inventory.ts";

async function main() {
  if (process.argv.slice(2).length !== 0) throw new Error();
  const local = await getPlatformProxy<{ REPORTS_DB?: Db }>({ configPath: new URL("../wrangler.jsonc", import.meta.url).pathname, remoteBindings: false, envFiles: [] });
  try {
    if (!local.env.REPORTS_DB) throw new Error();
    const result = await reportPrivacyInventory(local.env.REPORTS_DB, new Date());
    console.log(JSON.stringify(result));
    if (result.unreviewedTables > 0) process.exitCode = 2;
  } finally { await local.dispose(); }
}
main().catch(() => {
  console.log(JSON.stringify({ event: "reportPrivacyInventory", outcome: "unavailable" }));
  process.exitCode = 1;
});
