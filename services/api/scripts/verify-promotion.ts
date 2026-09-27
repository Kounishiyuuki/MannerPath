// Verifies a promotion bundle file immediately before it is applied (docs/OPERATIONS.md step 4).
//
// The expected hash is REQUIRED and must come from the reviewed record of the bundle (the PR or change
// record where the reviewer wrote down its contentSha256), never from the file itself: a hash written
// in the SQL file only proves the file agrees with itself. There is deliberately no header-only mode.
// Reads one local file; opens no database and sends nothing anywhere.
//
//   npm run local:verify-promotion -- --file promotion.sql --expected-content-sha256 <reviewed sha256>
import { readFileSync } from "node:fs";
import { PromotionError, verifyPromotionBundle } from "../src/pipeline/promotion.ts";

const USAGE = "Usage: verify-promotion.ts --file <bundle.sql> --expected-content-sha256 <64 hex, from the reviewed record>";
const args = { file: "", expected: "" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--file") args.file = argv[++i] ?? "";
  else if (arg === "--expected-content-sha256") args.expected = argv[++i] ?? "";
  else {
    console.error(`unknown argument: ${arg}. ${USAGE}`);
    process.exit(2);
  }
}
if (args.file === "" || args.expected === "") {
  console.error(`--file and --expected-content-sha256 are both required. ${USAGE}`);
  process.exit(2);
}

try {
  // fatal: bytes that are not UTF-8 must not be silently replaced before hashing.
  const sql = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(args.file));
  const hash = await verifyPromotionBundle(sql, args.expected);
  console.log(`verified ${args.file}: contentSha256 ${hash} matches its header and the reviewed record`);
} catch (e) {
  if (e instanceof PromotionError) {
    console.error(e.message);
    process.exit(1);
  }
  console.error(`verify-promotion: could not verify ${args.file}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
