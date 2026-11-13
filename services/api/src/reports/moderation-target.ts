// Which REPORTS_DB the maintainer's moderation tool talks to (ADR-0014 §8, scripts/report-queue.ts). Pure: it reads
// arguments and environment facts and returns a target or a refusal; it never connects anywhere.
//
// The default is LOCAL (wrangler's local state). A remote report store is reached only when every one of these holds,
// and there is no fallback: any doubt is a refusal, never a quiet switch to local or to another environment.
//   --remote                        explicit; nothing else implies it
//   --env staging|production        explicit; the top-level (local) environment is never remote
//   --database-id <uuid>            the reviewed REPORTS_DB id for that exact committed environment
//   --confirm-production <name>     production only: the exact report store name, typed out
//   an interactive terminal, not CI  so an agent, a script or a pipeline can never run it unattended
//
// The canonical DATA_DB is never remote here: canonical work (artifact import, apply, holds) runs on the local
// pipeline database and reaches production only through promotion (docs/OPERATIONS.md).

export type ModerationTarget =
  | { kind: "local" }
  | { kind: "remote"; environment: "staging" | "production"; databaseName: string; databaseId: string };

export type TargetResult = { ok: true; target: ModerationTarget; rest: string[] } | { ok: false; error: string };

const PLACEHOLDER = /^0{8}-0{4}-0{4}-0{4}-0{11}[0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The REPORTS_DB name of a remote environment, exactly as wrangler.jsonc names it. */
export const REPORT_STORE_NAMES = { staging: "mannerpath-staging-reports", production: "mannerpath-production-reports" } as const;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bindings = (value: unknown): Record<string, unknown>[] => {
  const items = record(value)?.d1_databases;
  if (!Array.isArray(items)) return [];
  const parsed = items.map(record);
  return parsed.every((item): item is Record<string, unknown> => item !== null) ? parsed : [];
};

/** Pure inventory check. Callers read the committed config before opening any connection; no ID is duplicated here. */
function reviewedReportId(committed: unknown, environment: "staging" | "production"): string | null {
  const env = record(record(committed)?.env);
  if (!env) return null;
  const canonicalIds = new Set([committed, ...Object.values(env)].flatMap(value =>
    bindings(value).filter(item => item.binding === "DB").map(item => item.database_id)));
  const ids = new Map<string, string>();
  for (const name of ["staging", "production"] as const) {
    const all = bindings(env[name]);
    const reports = all.filter(item => item.binding === "REPORTS_DB");
    const data = all.filter(item => item.binding === "DB");
    if (all.length !== 2 || reports.length !== 1 || data.length !== 1) return null;
    const id = reports[0]!.database_id, dataId = data[0]!.database_id;
    if (typeof id !== "string" || !UUID.test(id) || PLACEHOLDER.test(id)
      || typeof dataId !== "string" || !UUID.test(dataId) || PLACEHOLDER.test(dataId)
      || reports[0]!.database_name !== REPORT_STORE_NAMES[name] || reports[0]!.migrations_dir !== "migrations-reports"
      || data[0]!.migrations_dir !== "migrations" || canonicalIds.has(id) || [...ids.values()].includes(id)) return null;
    ids.set(name, id);
  }
  return ids.get(environment) ?? null;
}

export function moderationTarget(argv: readonly string[], facts: { interactive: boolean; ci: boolean }, committed?: unknown): TargetResult {
  const rest: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--remote") flags.remote = true;
    else if (a === "--env" || a === "--database-id" || a === "--confirm-production") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return { ok: false, error: `${a} needs a value` };
      flags[a.slice(2)] = v;
      i++;
    } else if (a.startsWith("--")) return { ok: false, error: `unknown flag ${a}` };
    else rest.push(a);
  }
  const remoteOnly = ["env", "database-id", "confirm-production"].filter((f) => f in flags);
  if (flags.remote !== true) {
    if (remoteOnly.length > 0) return { ok: false, error: `--${remoteOnly[0]} is a remote option; pass --remote explicitly (the default is local)` };
    return { ok: true, target: { kind: "local" }, rest };
  }
  const env = flags.env;
  if (env !== "staging" && env !== "production") return { ok: false, error: "--remote needs --env staging|production" };
  const id = flags["database-id"];
  if (typeof id !== "string" || !UUID.test(id) || PLACEHOLDER.test(id)) {
    return { ok: false, error: "--remote needs --database-id <the reviewed REPORTS_DB uuid>; placeholders are refused" };
  }
  const name = REPORT_STORE_NAMES[env];
  if (env === "production" && flags["confirm-production"] !== name) {
    return { ok: false, error: `production needs --confirm-production ${name}, typed exactly` };
  }
  if (!facts.interactive || facts.ci) {
    return { ok: false, error: "remote moderation runs only from a maintainer's interactive terminal, never from CI, a script or an agent" };
  }
  const expected = reviewedReportId(committed, env);
  if (expected === null || id !== expected) {
    return { ok: false, error: "remote REPORTS_DB identity does not match the reviewed environment configuration" };
  }
  return { ok: true, target: { kind: "remote", environment: env, databaseName: name, databaseId: id }, rest };
}

/** The one-line banner printed before anything runs, so the target is never a surprise. */
export function targetBanner(t: ModerationTarget): string {
  return t.kind === "local"
    ? "report store: LOCAL (wrangler local state); canonical: LOCAL"
    : `report store: REMOTE ${t.environment} ${t.databaseName} (${t.databaseId}); canonical: LOCAL`;
}
