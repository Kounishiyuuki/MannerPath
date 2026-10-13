// Maintainer-only REPORTS_DB tool. Dry-run by default; no HTTP endpoint or key revocation.
import { constants, openSync, fstatSync, readFileSync, closeSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { moderationTarget, type ModerationTarget } from "../src/reports/moderation-target.ts";
import {
  BulkRejectionError, BULK_REJECTION_REASONS, BULK_REJECTION_MAX,
  planBulkReportRejection, applyBulkReportRejection, type BulkRejectionPlan, type BulkSelector, type KeySelection,
} from "../src/reports/bulk-rejection.ts";
import type { Db } from "../src/db.ts";

class CliRefusal extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const API_DIR = fileURLToPath(new URL("../", import.meta.url));
const refuse = (): never => { throw new CliRefusal("invalidArguments"); };
export function parseBulkArguments(argv: readonly string[], facts: { interactive: boolean; ci: boolean }) {
  const args = [...argv];
  const mode = args[0] === "apply" ? (args.shift(), "apply") : (args[0] === "plan" && args.shift(), "plan");
  const flags = new Map<string, string>();
  const targetArgs: string[] = [];
  let dryRun = false;
  const targetFlags = ["--env", "--database-id", "--confirm-production"];
  const allowed = mode === "apply"
    ? ["--plan", "--confirm", "--key-file", "--pepper-file", "--persist-to"]
    : ["--ids-file", "--from", "--before", "--states", "--reason", "--decided-by", "--max-count", "--out", "--key-file", "--pepper-file", "--persist-to"];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flags.has(flag)) refuse();
    if (flag === "--remote") { flags.set(flag, "true"); targetArgs.push(flag); continue; }
    if (flag === "--dry-run") { if (mode === "apply") refuse(); flags.set(flag, "true"); dryRun = true; continue; }
    if (!allowed.includes(flag) && !targetFlags.includes(flag)) refuse();
    const value = args[++i];
    if (!value || value.startsWith("--")) refuse();
    flags.set(flag, value);
    if (targetFlags.includes(flag)) targetArgs.push(flag, value);
  }
  const target = moderationTarget(targetArgs, facts);
  if (!target.ok || (target.target.kind === "remote" && flags.has("--persist-to"))) refuse();
  if (flags.has("--key-file") !== flags.has("--pepper-file")) refuse();
  if (mode === "apply") {
    if (!flags.has("--plan") || !/^[0-9a-f]{64}$/.test(flags.get("--confirm") ?? "")) refuse();
  } else {
    if (!flags.has("--out") || !BULK_REJECTION_REASONS.includes(flags.get("--reason") as any)
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(flags.get("--decided-by") ?? "")) refuse();
    if (!flags.has("--ids-file") && !flags.has("--from") && !flags.has("--key-file")) refuse();
    if (flags.has("--from") !== flags.has("--before")) refuse();
    if (flags.has("--max-count") && (!/^[1-9][0-9]*$/.test(flags.get("--max-count")!)
      || Number(flags.get("--max-count")) > BULK_REJECTION_MAX)) refuse();
  }
  return { mode, flags, target: target.target, dryRun };
}

/** No symlinks, oversized files or group/world access; never echo file contents or errors. */
export function readPrivateInput(path: string, maximum: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum || (stat.mode & 0o077) !== 0) throw new Error();
    const bytes = readFileSync(fd);
    if (bytes.length > maximum) throw new Error();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { throw new CliRefusal("unsafeInputFile"); }
  finally { if (fd !== undefined) closeSync(fd); }
}

function keyInputs(flags: Map<string, string>): KeySelection | undefined {
  if (!flags.has("--key-file")) return undefined;
  return { keyId: readPrivateInput(flags.get("--key-file")!, 1024).trim(),
    pepper: readPrivateInput(flags.get("--pepper-file")!, 4096) };
}

function jsonInput(path: string, maximum: number): unknown {
  try { return JSON.parse(readPrivateInput(path, maximum)); }
  catch { throw new CliRefusal("invalidInputFile"); }
}

// The envelope binds environment/ID/path as well as the immutable DB identity in the plan.
function targetDescriptor(target: ModerationTarget, flags: Map<string, string>) {
  return target.kind === "local"
    ? { kind: "local", persistTo: resolve(flags.get("--persist-to") ?? join(API_DIR, ".wrangler/state")) }
    : { kind: "remote", environment: target.environment, databaseId: target.databaseId };
}

async function runBulkCli(argv: readonly string[]) {
  const facts = { interactive: process.stdin.isTTY === true && process.stdout.isTTY === true, ci: Boolean(process.env.CI) };
  const { mode, flags, target } = parseBulkArguments(argv, facts);
  const key = keyInputs(flags);
  const descriptor = targetDescriptor(target, flags);
  let plan: BulkRejectionPlan | undefined;
  let selector: BulkSelector | undefined;
  if (mode === "apply") {
    const file = jsonInput(flags.get("--plan")!, 80_000) as any;
    if (!file || Object.keys(file).sort().join(",") !== "format,plan,target" || file.format !== "bulk-report-plan.v1"
      || JSON.stringify(file.target) !== JSON.stringify(descriptor)) throw new CliRefusal("targetMismatch");
    plan = file.plan;
    if (plan?.digest !== flags.get("--confirm")) throw new CliRefusal("confirmationMismatch");
  } else {
    const ids = flags.has("--ids-file") ? jsonInput(flags.get("--ids-file")!, 8192) : undefined;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== "string"))) refuse();
    selector = { reportIds: ids as string[] | undefined, from: flags.get("--from"), before: flags.get("--before"),
      keyRequired: key !== undefined, states: flags.get("--states")?.split(",") as BulkSelector["states"] };
  }
  // Only after strict options/files/target checks may a DB connection be opened.
  // These are process-local diagnostic controls, not Worker/account settings. Do not persist
  // RPC/SQL diagnostics from an operator tool that handles ephemeral private selectors.
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_LOG_SANITIZE = "true";
  process.env.WRANGLER_LOG = "error";
  const { getPlatformProxy } = await import("wrangler");
  const cwd = API_DIR;
  let dir: string | undefined;
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ REPORTS_DB: Db }>>> | undefined;
  try {
    if (target.kind === "remote") {
      dir = mkdtempSync(join(tmpdir(), "mannerpath-bulk-reject-"));
      const configPath = join(dir, "wrangler.json");
      writeFileSync(configPath, JSON.stringify({ name: "mannerpath-bulk-rejection", compatibility_date: "2026-09-01",
        d1_databases: [{ binding: "REPORTS_DB", database_name: target.databaseName, database_id: target.databaseId, remote: true }] }), { mode: 0o600 });
      proxy = await getPlatformProxy<{ REPORTS_DB: Db }>({ configPath, remoteBindings: true, persist: false });
    } else {
      proxy = await getPlatformProxy<{ REPORTS_DB: Db }>({ configPath: join(cwd, "wrangler.jsonc"), remoteBindings: false,
        // Wrangler d1 migrations/execute add v3 to --persist-to; the proxy API expects that final root.
        persist: { path: join(descriptor.kind === "local" ? descriptor.persistTo! : join(cwd, ".wrangler/state"), "v3") } });
    }
    if (mode === "plan") {
      const created = await planBulkReportRejection(proxy.env.REPORTS_DB, {
        selector: selector!, reason: flags.get("--reason") as any, decidedBy: flags.get("--decided-by")!,
        maxCount: flags.has("--max-count") ? Number(flags.get("--max-count")) : undefined, now: new Date(), key,
      });
      // Exclusive creation prevents overwriting reviewed plans. A partial write is not a valid JSON/digest.
      writeFileSync(resolve(flags.get("--out")!), JSON.stringify({ format: "bulk-report-plan.v1", target: descriptor, plan: created }, null, 2),
        { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ mode: "dryRun", count: created.targets.length, digest: created.digest, target: target.kind }));
    } else {
      const result = await applyBulkReportRejection(proxy.env.REPORTS_DB, plan!, {
        confirmation: flags.get("--confirm")!, now: new Date(), key,
      });
      console.log(JSON.stringify({ mode: "apply", ...result, target: target.kind }));
    }
  } finally {
    await proxy?.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runBulkCli(process.argv.slice(2)); }
  catch (error) {
    const code = error instanceof BulkRejectionError || error instanceof CliRefusal ? error.code : "operationFailed";
    console.error(`refused: ${/^[A-Za-z0-9]{1,80}$/.test(code) ? code : "operationFailed"}`);
    process.exitCode = 2;
  }
}
