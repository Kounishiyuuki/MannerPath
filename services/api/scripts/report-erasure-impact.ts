// LOCAL ONLY, read-only (ADR-0021 §10). Prints counts and states of what references one report; no remote target.
//   npm run local:reports:erasure-impact -- rp_...
import { getPlatformProxy } from "wrangler";
import type { Db } from "../src/db.ts";
import { erasureImpact } from "../src/reports/erasure-impact.ts";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^rp_[0-9A-HJKMNP-TV-Z]{26}$/.test(args[0])) throw new Error("Invalid local impact request");
  const local = await getPlatformProxy<{ REPORTS_DB?: Db }>({ configPath: new URL("../wrangler.jsonc", import.meta.url).pathname, remoteBindings: false, envFiles: [] });
  try {
    if (!local.env.REPORTS_DB) throw new Error("Report store unavailable");
    const impact = await erasureImpact(local.env.REPORTS_DB, args[0], new Date());
    if (!impact) { console.error("No report with this ID in the local report store"); process.exitCode = 1; return; }
    console.log(JSON.stringify(impact, null, 2));
  } finally {
    await local.dispose();
  }
}
main().catch(() => {
  console.error("erasure-impact unavailable");
  process.exitCode = 1;
});
