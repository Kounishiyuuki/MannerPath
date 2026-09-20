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
import { writeFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { type Db } from "../src/db.ts";
import { PromotionError, buildPromotionBundle } from "../src/pipeline/promotion.ts";

const args = { releaseId: undefined as number | undefined, out: "", print: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--print") args.print = true;
  else if (arg === "--out") args.out = argv[++i] ?? "";
  else if (arg === "--release") args.releaseId = Number(argv[++i]);
  else {
    console.error(`unknown argument: ${arg}. Usage: export-promotion.ts [--release <id>] [--out <path>] [--print]`);
    process.exit(2);
  }
}

const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
try {
  const bundle = await buildPromotionBundle(proxy.env.DB, { releaseId: args.releaseId });
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
