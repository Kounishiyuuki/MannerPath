// Reads the FREE-TIER PROBE's CPU time from Cloudflare's GraphQL Analytics API (aggregate only: no request URLs or
// bodies). Run by the operator after free-probe:run; makes ONE read-only HTTPS call to api.cloudflare.com.
//
//   CLOUDFLARE_API_TOKEN=… npm run free-probe:analytics -- --account-id <id> --since <ISO> --until <ISO>
//
// Query shape from developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics (read 2026-10-31):
// workersInvocationsAdaptive, filter scriptName/datetime_geq/datetime_leq, sum requests/errors, quantiles
// cpuTimeP50/cpuTimeP99, dimensions status. The tutorial does not state the unit (microseconds is assumed and printed
// as such) nor the status vocabulary; the raw response is printed too so neither is silently misread.
import { PROBE_WORKER } from "./free-tier-probe-config.ts";

const QUERY = `query ($accountTag: string!, $scriptName: string!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 100, filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until }) {
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP99 }
      dimensions { status }
    }
  } }
}`;

async function main(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--account-id", "--since", "--until"].includes(argv[i])) throw new Error(`unknown argument ${argv[i]}`);
    a[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  const token = process.env.CLOUDFLARE_API_TOKEN; delete process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("set CLOUDFLARE_API_TOKEN (Account Analytics: Read) in the environment");
  if (!/^[0-9a-f]{32}$/.test(a["account-id"] ?? "")) throw new Error("--account-id must be the 32-hex account ID");
  for (const k of ["since", "until"]) if (Number.isNaN(Date.parse(a[k] ?? ""))) throw new Error(`--${k} must be an ISO timestamp`);
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { accountTag: a["account-id"], scriptName: PROBE_WORKER, since: a.since, until: a.until } }),
  });
  const body = await res.json() as { data?: any; errors?: unknown[] };
  if (!res.ok || body.errors?.length) throw new Error(`GraphQL ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 400)}`);
  const rows = body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  for (const r of rows) {
    console.log(`status=${r.dimensions.status} requests=${r.sum.requests} errors=${r.sum.errors} cpuP50=${r.quantiles.cpuTimeP50} µs? cpuP99=${r.quantiles.cpuTimeP99} µs?`);
  }
  console.log("raw:", JSON.stringify(rows));
}
main(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
