// The maintainer's source-evidence hold (ADR-0018 §5, migration 0033). Always the LOCAL canonical DB; canonical data
// reaches staging/production only through promotion (docs/OPERATIONS.md). Source health never runs this.
//
//   npm run --silent source:health -- --live --source=<id> > report.json   # --silent: stdout is the JSON only
//   npm run source:hold -- hold --source=<id> --report=report.json --by=<maintainer>
//   npm run source:hold -- clear --source=<id> --by=<maintainer> --basis=factsReReviewed|healthFalsePositive
//
// Each command writes its hold/clear and the republished local tiles in one batch: all of it commits, or none of it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getPlatformProxy } from "wrangler";
import type { Db } from "../src/db.ts";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { type EvidenceHoldClearBasis, clearSourceEvidenceHolds, holdSourceEvidence } from "../src/pipeline/evidence-hold.ts";
import type { HealthReport } from "../src/source-health/evaluate.ts";

const USAGE = "Usage: npm run source:hold -- (hold --source=<id> --report=<file> | clear --source=<id> --basis=<factsReReviewed|healthFalsePositive>) --by=<maintainer>";

export async function run(db: Db, args: string[], now: Date): Promise<unknown> {
  const [command, ...rest] = args;
  const flag = (name: string) => {
    const values = rest.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
    if (values.length !== 1 || values[0] === "") throw new Error(`${USAGE}\nmissing or repeated --${name}`);
    return values[0];
  };
  const known = command === "hold" ? ["source", "report", "by"] : command === "clear" ? ["source", "basis", "by"] : null;
  if (known === null || rest.some((a) => !known.some((k) => a.startsWith(`--${k}=`)))) throw new Error(USAGE);
  const adapter = SOURCE_ADAPTERS.find((a) => a.registry.sourceId === flag("source"));
  if (!adapter) throw new Error(`Unknown reviewed source id ${flag("source")}`);
  if (command === "hold") {
    const bytes = readFileSync(flag("report"));
    const report = JSON.parse(bytes.toString("utf8")) as HealthReport;
    if (report.version !== 2) throw new Error(`health report version ${String(report.version)} is not 2`);
    return holdSourceEvidence(db, adapter.registry, report, {
      reportSha256: createHash("sha256").update(bytes).digest("hex"), heldBy: flag("by"), now,
    });
  }
  const basis = flag("basis");
  if (basis !== "factsReReviewed" && basis !== "healthFalsePositive") throw new Error(USAGE);
  return clearSourceEvidenceHolds(db, adapter.registry.sourceId, { clearedBy: flag("by"), basis: basis as EvidenceHoldClearBasis, now });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const local = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
  try {
    console.log(JSON.stringify(await run(local.env.DB, process.argv.slice(2), new Date()), null, 2));
  } finally {
    await local.dispose();
  }
}
