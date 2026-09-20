// Beta data-quality report for the LOCAL D1 database (Issue #33, docs/BETA_DATA_QUALITY.md).
//
// LOCAL AND READ-ONLY. The binding is opened with `remoteBindings: false`, like local:pipeline and
// local:export, so it can only read `.wrangler/state`; the analysis itself issues SELECTs only.
//
//   npx wrangler d1 migrations apply DB --local
//   npm run local:pipeline
//   npm run local:quality            # JSON report on stdout; exit 1 if a check fails
import { gzipSync } from "node:zlib";
import { getPlatformProxy } from "wrangler";
import { type Db, isoSeconds } from "../src/db.ts";
import { analyzeCorpus } from "../src/quality/analyze.ts";

const argv = process.argv.slice(2);
let now = isoSeconds(new Date());
for (let i = 0; i < argv.length; i++) {
  // --now fixes the reference instant, so a report committed to the repository can be regenerated.
  if (argv[i] === "--now") now = argv[++i] ?? "";
  else {
    console.error(`unknown argument: ${argv[i]}. Usage: data-quality.ts [--now <ISO-8601 UTC>]`);
    process.exit(2);
  }
}

const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
try {
  const report = await analyzeCorpus(proxy.env.DB, { now, gzip: (body) => gzipSync(body).length });
  console.log(JSON.stringify(report, null, 2));
  if (report.failedChecks > 0) {
    console.error(`${report.failedChecks} check(s) failed: ${report.checks.filter((c) => c.status === "fail").map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
} finally {
  await proxy.dispose();
}
