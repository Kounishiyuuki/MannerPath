// Which REPORTS_DB the maintainer's moderation tool talks to (ADR-0014 §8, scripts/report-queue.ts). Pure: it reads
// arguments and environment facts and returns a target or a refusal; it never connects anywhere.
//
// The default is LOCAL (wrangler's local state). A remote report store is reached only when every one of these holds,
// and there is no fallback: any doubt is a refusal, never a quiet switch to local or to another environment.
//   --remote                        explicit; nothing else implies it
//   --env staging|production        explicit; the top-level (local) environment is never remote
//   --database-id <uuid>            the real REPORTS_DB id, supplied at the console (committed ids are placeholders)
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

export function moderationTarget(argv: readonly string[], facts: { interactive: boolean; ci: boolean }): TargetResult {
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
    return { ok: false, error: "--remote needs --database-id <the real REPORTS_DB uuid> (committed ids are placeholders)" };
  }
  const name = REPORT_STORE_NAMES[env];
  if (env === "production" && flags["confirm-production"] !== name) {
    return { ok: false, error: `production needs --confirm-production ${name}, typed exactly` };
  }
  if (!facts.interactive || facts.ci) {
    return { ok: false, error: "remote moderation runs only from a maintainer's interactive terminal, never from CI, a script or an agent" };
  }
  return { ok: true, target: { kind: "remote", environment: env, databaseName: name, databaseId: id }, rest };
}

/** The one-line banner printed before anything runs, so the target is never a surprise. */
export function targetBanner(t: ModerationTarget): string {
  return t.kind === "local"
    ? "report store: LOCAL (wrangler local state); canonical: LOCAL"
    : `report store: REMOTE ${t.environment} ${t.databaseName} (${t.databaseId}); canonical: LOCAL`;
}
