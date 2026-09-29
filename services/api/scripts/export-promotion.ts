// Generates the promotion bundle for a release in the LOCAL D1 database (docs/OPERATIONS.md).
//
// LOCAL AND DRY BY DEFAULT. The binding is opened with `remoteBindings: false`, exactly like
// local:pipeline, so this can only read `.wrangler/state`. With no arguments it validates the local
// state and prints the manifest — it writes nothing. The SQL artifact is produced only when the
// caller asks for it with --out or --print, and applying it is a separate human step.
//
//   npm run local:export                          # validate + manifest, writes nothing
//   npm run local:export -- --out promotion.sql   # write the reviewable artifact
//   npm run local:export -- --release 1 --print   # artifact to stdout
//   npm run local:export -- --bundle v3 --out promotion.sql                     # every source's current release
//   npm run local:export -- --bundle v3 --release 1 --release 2 --out promotion.sql
import { writeFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { type Db } from "../src/db.ts";
import { PromotionError, buildMultiSourcePromotionBundle, buildPromotionBundle } from "../src/pipeline/promotion.ts";

const USAGE = "Usage: export-promotion.ts [--bundle v2|v3] [--release <id>]... [--out <path>] [--print]";
const args = { bundle: "v2", releaseIds: [] as number[], out: "", print: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--print") args.print = true;
  else if (arg === "--out") args.out = argv[++i] ?? "";
  else if (arg === "--release") args.releaseIds.push(Number(argv[++i]));
  else if (arg === "--bundle") args.bundle = argv[++i] ?? "";
  else {
    console.error(`unknown argument: ${arg}. ${USAGE}`);
    process.exit(2);
  }
}
if (args.bundle !== "v2" && args.bundle !== "v3") {
  console.error(`--bundle must be v2 or v3, got ${args.bundle}. ${USAGE}`);
  process.exit(2);
}
// v2 carries exactly one release; several sources need v3, never a silent choice of one of them.
if (args.bundle === "v2" && args.releaseIds.length > 1) {
  console.error(`a v2 bundle carries one release; use --bundle v3 for several. ${USAGE}`);
  process.exit(2);
}

const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
try {
  const bundle = args.bundle === "v3"
    ? await buildMultiSourcePromotionBundle(proxy.env.DB, { releaseIds: args.releaseIds.length > 0 ? args.releaseIds : undefined })
    : await buildPromotionBundle(proxy.env.DB, { releaseId: args.releaseIds[0] });
  if (args.print) console.log(bundle.sql);
  if (args.out !== "") {
    writeFileSync(args.out, bundle.sql);
    console.error(`wrote ${args.out}`);
  }
  // The manifest goes to stderr when the artifact owns stdout, so --print stays pipeable.
  const manifest = JSON.stringify(bundle.manifest, null, 2);
  if (args.print) console.error(manifest);
  else console.log(manifest);
  if (args.out === "" && !args.print) {
    console.error("validated only; nothing was written. Pass --out <path> to generate the artifact.");
  }
} catch (e) {
  if (e instanceof PromotionError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
} finally {
  await proxy.dispose();
}
