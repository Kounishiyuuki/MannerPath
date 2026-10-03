// Explicit filesystem SQLite simulation only. No Wrangler, credentials, network or remote write path.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { exportPromotionV4 } from "./promotion-v4-export.ts";
import { verifyPromotionV4 } from "./promotion-v4-verify.ts";
import { applyPromotionV4 } from "./promotion-v4-apply.ts";
import { prepareV4ImportPlan, verifyV4ImportPlan } from "./promotion-v4-import-plan.ts";

if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("promotion v4 tools require Node >=24 for bounded SQLite cursors");
const [command, ...argv] = process.argv.slice(2);
const flags: Record<string, string[]> = {
  build: ["--database", "--dir", "--chunk-bytes"],
  verify: ["--dir", "--expected-digest"],
  "apply-local": ["--database", "--dir", "--expected-digest", "--stop-after"],
  "prepare-import": ["--dir", "--out", "--expected-digest"],
  "verify-import-plan": ["--dir", "--expected-digest", "--expected-plan-digest"],
};
if (!Object.hasOwn(flags, command)) throw new Error("v4 command must be build, verify, apply-local, prepare-import or verify-import-plan");
const args = new Map<string, string>();
for (let i = 0; i < argv.length; i += 2) {
  const flag = argv[i], value = argv[i + 1];
  if (!flags[command].includes(flag) || !value || value.startsWith("--") || args.has(flag)) throw new Error(`invalid/missing/duplicate option for v4 ${command}: ${flag}`);
  args.set(flag, value);
}
const directory = args.get("--dir");
if (!directory) throw new Error("--dir is required");
const digest = args.get("--expected-digest") ?? "";
if (command === "prepare-import") {
  const output = args.get("--out");
  if (!output) throw new Error("prepare-import requires --out for a new import-plan directory");
  console.log(JSON.stringify(await prepareV4ImportPlan(directory, digest, output), null, 2));
} else if (command === "verify-import-plan") {
  const plan = await verifyV4ImportPlan(directory, args.get("--expected-plan-digest") ?? "", digest);
  console.log(JSON.stringify({ status: "verified", sourceDigest: plan.sourceManifestSha256, planDigest: plan.wholePlanSha256, files: plan.files.length }));
} else if (command === "verify") {
  if (args.has("--database") || args.has("--chunk-bytes") || args.has("--stop-after")) throw new Error("verify accepts only --dir and --expected-digest");
  const manifest = await verifyPromotionV4(directory, digest);
  console.log(JSON.stringify({ status: "verified", digest: manifest.wholeBundleSha256, chunks: manifest.chunks.length }));
} else {
  const database = args.get("--database");
  if (!database || /^(https?:|file:)/.test(database) || database === ":memory:") throw new Error("--database must be an explicit local SQLite file path");
  if (command === "build" && (!existsSync(database) || args.has("--expected-digest") || args.has("--stop-after"))) throw new Error("build requires existing local DATA database and explicit --chunk-bytes");
  if (command === "apply-local" && args.has("--chunk-bytes")) throw new Error("apply-local does not accept --chunk-bytes");
  // Preflight before even creating a target file. Applying cannot accidentally clobber the origin.
  if (command === "apply-local") await verifyPromotionV4(directory, digest);
  const fresh = !existsSync(database);
  const db = new DatabaseSync(resolve(database), command === "build" ? { readOnly: true } : {});
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;");
    if (fresh) {
      for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) {
        db.exec("BEGIN");
        try { db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8")); db.exec("COMMIT"); }
        catch (error) { db.exec("ROLLBACK"); throw error; }
      }
    }
    const result = command === "build"
      ? await exportPromotionV4(db, directory, { chunkBytes: Number(args.get("--chunk-bytes")) })
      : await applyPromotionV4(db, directory, digest, args.has("--stop-after") ? { stopAfter: Number(args.get("--stop-after")) } : {});
    console.log(JSON.stringify(result, null, 2));
  } finally { db.close(); }
}
