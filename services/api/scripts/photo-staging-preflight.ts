// Offline inspection only. No Wrangler SDK, subprocess, environment credentials or network APIs.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { photoIntakePolicy } from '../src/reports/photo-policy.ts';
import { CURRENT_REPORT_TERMS } from '../src/reports/terms.ts';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
const dbSchema = z.object({ binding: z.string(), database_name: identifier, database_id: z.string(), migrations_dir: z.string() }).strict();
const configSchema = z.object({
  $schema: z.string().optional(), name: identifier, main: z.string(), compatibility_date: z.string(),
  account_id: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  workers_dev: z.boolean(), preview_urls: z.boolean(),
  observability: z.object({ enabled: z.boolean(), logs: z.object({ enabled: z.boolean(), invocation_logs: z.boolean() }).strict() }).strict(),
  vars: z.object({ REPORT_ATTESTATION: z.string(), REPORT_REGISTRATION: z.string(), PHOTO_EVIDENCE: z.string(), REPORT_RETENTION: z.string() }).strict(),
  triggers: z.object({ crons: z.array(z.string()) }).strict(),
  d1_databases: z.array(dbSchema),
  r2_buckets: z.array(z.object({ binding: z.string(), bucket_name: identifier }).strict()),
  routes: z.array(z.object({ pattern: z.string(), custom_domain: z.literal(true) }).strict()).optional(),
}).strict();

export const operatorChecks = [
  'Cloudflare resource existence, account ownership and complete production resource/origin inventory: NOT VERIFIED.',
  'Token/IAM scopes and Admin UUID/bucket targets, including inability to access production: NOT VERIFIED.',
  'Protected staging hostname, DNS/certificate, edge rules and absence of alternate ingress: NOT VERIFIED.',
  'Private R2 settings, exclusive writers, no copies and permanent deletion fences/provider guarantees: NOT VERIFIED.',
  'Remote migration ledger/schema, deployed code/Secrets/flags and actual Cron state: NOT VERIFIED.',
  'Exact photo consent approval, physical-iPhone origin/App Attest and operator acceptance: NOT VERIFIED.',
] as const;
type Check = { id: string; status: 'PASS' | 'BLOCKED'; message: string };
export type PreflightResult = { offlineStatus: 'PASS' | 'BLOCKED'; executionStatus: 'BLOCKED'; checks: Check[]; operatorChecks: readonly string[] };
function result(checks: Check[]): PreflightResult {
  return { offlineStatus: checks.every(c => c.status === 'PASS') ? 'PASS' : 'BLOCKED', executionStatus: 'BLOCKED', checks, operatorChecks };
}
function blocked(id: string, message: string) { return result([{ id, status: 'BLOCKED', message }]); }

/** Restricted JSONC: comments allowed; duplicate/escaped-duplicate keys and trailing commas refused.
 * Validate with our own token walk before JSON.parse, so parser errors never escape with input text. */
export function parsePreflightJsonc(source: string): unknown {
  const tokens: string[] = []; let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const match = /^(?:[ \t\r\n]+|\/\/[^\r\n]*(?:\r\n|\r|\n|$)|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (match) { i += match[0].length; continue; }
    const token = /^(?:"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,])/.exec(rest);
    if (!token) throw new Error('invalidConfig');
    tokens.push(token[0]); i += token[0].length;
  }
  let cursor = 0;
  function value(depth = 0): void {
    if (depth > 32) throw new Error('invalidConfig');
    const token = tokens[cursor++];
    if (token === '{') {
      const keys = new Set<string>();
      if (tokens[cursor] === '}') { cursor++; return; }
      while (true) {
        const keyToken = tokens[cursor++];
        if (!keyToken?.startsWith('"')) throw new Error('invalidConfig');
        const key = JSON.parse(keyToken);
        if (keys.has(key) || tokens[cursor++] !== ':') throw new Error('invalidConfig');
        keys.add(key); value(depth + 1);
        const next = tokens[cursor++]; if (next === '}') return;
        if (next !== ',') throw new Error('invalidConfig');
      }
    }
    if (token === '[') {
      if (tokens[cursor] === ']') { cursor++; return; }
      while (true) { value(depth + 1); const next = tokens[cursor++]; if (next === ']') return; if (next !== ',') throw new Error('invalidConfig'); }
    }
    if (!token || /^[}\]:,]$/.test(token)) throw new Error('invalidConfig');
  }
  value(); if (cursor !== tokens.length) throw new Error('invalidConfig');
  return JSON.parse(tokens.join(''));
}
function readConfig(path: string): unknown {
  if (!['.json', '.jsonc'].includes(extname(path)) || !['.json', '.jsonc'].includes(extname(realpathSync(path)))
    || !statSync(path).isFile() || statSync(path).size > 262144) throw new Error('invalidConfig');
  return parsePreflightJsonc(readFileSync(path, 'utf8'));
}
function host(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(url.hostname)) return;
    return url.hostname;
  } catch { return; }
}
function overlaps(a: string, b: string) { return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`); }

export function migrationNamesValid(names: string[], original: string[], reportStream: boolean): boolean {
  return JSON.stringify(names) === JSON.stringify(original)
    && (!reportStream || ['0008_admin_review_audit.sql', '0009_new_spot_photo_gate.sql', '0010_new_spot_photo_erasure_window.sql'].every(n => names.includes(n)))
    && names.every((n, i) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && Number(n.slice(0, 4)) === i + 1);
}

/** Only fixed check IDs/messages are returned. No input value/path, parse issue, secret or exception is reflected. */
export function photoStagingPreflight(input: { configPath: string; productionOrigins: string[] }): PreflightResult {
  try {
    const checks: Check[] = [];
    const check = (id: string, ok: boolean, message: string) => checks.push({ id, status: ok ? 'PASS' : 'BLOCKED', message });
    const parsed = configSchema.safeParse(readConfig(input.configPath));
    if (!parsed.success) return blocked('config-shape', 'Missing, unknown or unsupported configuration; review the initial-state template.');
    const c = parsed.data;
    const baseline = z.object({ env: z.object({ production: z.object({
      name: identifier, d1_databases: z.array(dbSchema).min(2),
      r2_buckets: z.array(z.object({ binding: z.string(), bucket_name: identifier }).passthrough()).min(1),
    }).passthrough() }).passthrough() }).passthrough().safeParse(readConfig(resolve(apiDir, 'wrangler.jsonc')));
    if (!baseline.success) return blocked('production-baseline', 'Production inventory cannot be validated.');
    const p = baseline.data.env.production;
    check('worker-isolation', c.name !== p.name && c.name.includes('staging'), 'Worker must be explicitly staging and distinct from committed production.');
    check('initial-policy', c.vars.REPORT_ATTESTATION === 'required' && c.vars.REPORT_REGISTRATION === 'paused'
      && c.vars.PHOTO_EVIDENCE === 'off' && c.vars.REPORT_RETENTION === 'off', 'App Attest must be required; registration, photo intake and retention initially disabled.');
    check('cron-disabled', c.triggers.crons.length === 0, 'Initial Cron schedule must be empty.');
    check('ingress-disabled', c.workers_dev === false && c.preview_urls === false, 'workers.dev and preview URLs must be disabled.');
    check('private-logs', c.observability.logs.invocation_logs === false, 'Invocation URL logging must be disabled.');
    check('bindings', c.d1_databases.length === 2 && c.d1_databases.filter(d => d.binding === 'DB').length === 1
      && c.d1_databases.filter(d => d.binding === 'REPORTS_DB').length === 1
      && c.r2_buckets.length === 1 && c.r2_buckets[0].binding === 'PRIVATE_PHOTOS', 'Exactly DB (canonical DATA_DB), REPORTS_DB and PRIVATE_PHOTOS are required; aliases/additional bindings are unsupported.');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const validIds = c.d1_databases.every(d => uuid.test(d.database_id) && !/^0{8}-0{4}-0{4}-0{4}-0{11}[0-9]$/.test(d.database_id));
    check('database-identities', validIds && c.d1_databases.every(d => d.database_name.includes('staging')
      && !p.d1_databases.some(prod => prod.database_id.toLowerCase() === d.database_id.toLowerCase() || prod.database_name === d.database_name))
      && new Set(c.d1_databases.map(d => d.database_id)).size === 2 && new Set(c.d1_databases.map(d => d.database_name)).size === 2,
      'D1 IDs must be non-placeholder, distinct from each other and production; names must identify staging.');
    check('bucket-isolation', c.r2_buckets.length === 1 && c.r2_buckets.every(b => b.bucket_name.includes('staging') && !p.r2_buckets.some(prod => prod.bucket_name === b.bucket_name)), 'Private bucket must identify staging and differ from all committed production buckets.');
    const origins = input.productionOrigins.map(host);
    const inventoryValid = origins.length > 0 && origins.every(h => h !== undefined);
    check('production-origins', inventoryValid, 'Explicit complete reviewed production HTTPS origin inventory is required; completeness needs operator verification.');
    // No wildcard/path/zone route parsing guesses: only exact custom-domain hostnames are supported.
    const routes = c.routes ?? [];
    const productionRoutesAbsent = !('routes' in p) && !('route' in p);
    check('routes-isolation', inventoryValid && productionRoutesAbsent && routes.every(r => {
      const h = host(`https://${r.pattern}`);
      return !!h && h === r.pattern && h.includes('staging') && !origins.some(prod => prod && overlaps(h, prod));
    }), 'Only exact staging custom-domain hosts disjoint from production origins are supported; new production route configuration requires review.');
    // Strict schema rejects env, service bindings, unsafe bindings, origin aliases and build overrides.
    check('no-fallback', true, 'Strict initial-state schema has no env block, service fallback, origin alias or build override.');
    check('entrypoint', c.compatibility_date === '2026-09-01'
      && realpathSync(resolve(dirname(input.configPath), c.main)) === realpathSync(resolve(apiDir, 'src/index.ts')), 'Use the reviewed Worker entrypoint and compatibility date; alternate code is unsupported.');
    for (const [binding, stream] of [['DB', 'migrations'], ['REPORTS_DB', 'migrations-reports']] as const) {
      let ok = false;
      try {
        const d = c.d1_databases.find(d => d.binding === binding);
        if (d) {
          const actual = realpathSync(resolve(dirname(input.configPath), d.migrations_dir));
          const expected = resolve(apiDir, stream);
          const names = readdirSync(actual).sort();
          const original = readdirSync(expected).sort();
          ok = migrationNamesValid(names, original, stream === 'migrations-reports') && names.every(n =>
            statSync(resolve(actual, n)).isFile() && statSync(resolve(actual, n)).size === statSync(resolve(expected, n)).size
            && readFileSync(resolve(actual, n)).equals(readFileSync(resolve(expected, n))));
        }
      } catch { /* fixed redacted finding only */ }
      check(`${binding.toLowerCase()}-migrations`, ok, 'Full original migration stream, sequential numbering and unchanged bytes are required; bootstrap subsets are not final configs.');
    }
    const policy = photoIntakePolicy({ PHOTO_EVIDENCE: 'on', REPORT_RETENTION: 'cleanup', REPORT_RETENTION_CRON: '*/5 * * * *',
      PHOTO_STORAGE_POLICY: 'private-no-copies-permanent-fences.v1', REPORT_ATTESTATION: 'required',
      REPORT_APP_ATTEST_APP_ID: 'ABCDE12345.com.example.mannerpath', REPORT_APP_ATTEST_ENVIRONMENT: 'development',
      REPORT_APP_ATTEST_BUNDLE_VERSIONS: '41', REPORT_SUBMITTER_PEPPER: 'x'.repeat(32),
      REPORTS_DB: {} as any, PRIVATE_PHOTOS: { put() {}, head() {} } as any });
    check('photo-consent-gate', policy.photoTermsCovered(CURRENT_REPORT_TERMS.version) || policy.enabled === false,
      'Repository runtime policy must refuse photo intake for an unreviewed current consent version; this does not grant consent.');
    return result(checks);
  } catch { return blocked('config-read', 'Configuration, baseline or referenced local files are unreadable, invalid or unsupported.'); }
}

export function runPhotoStagingPreflight(argv: string[]): { exitCode: number; output: PreflightResult } {
  try {
    if (Number(process.versions.node.split('.')[0]) < 24) return { exitCode: 2, output: blocked('node-version', 'Node 24 or newer is required.') };
    let configPath: string | undefined; const productionOrigins: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const flag = argv[i]; const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('arguments');
      if (flag === '--config' && !configPath) configPath = value;
      else if (flag === '--production-origin') productionOrigins.push(value);
      else throw new Error('arguments');
    }
    if (!configPath) throw new Error('arguments');
    const output = photoStagingPreflight({ configPath: resolve(configPath), productionOrigins });
    return { exitCode: output.offlineStatus === 'PASS' ? 0 : 2, output };
  } catch { return { exitCode: 2, output: blocked('arguments', 'Use --config <local-jsonc> and repeated --production-origin <https-origin>; no remote/action/env options exist.') }; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = runPhotoStagingPreflight(process.argv.slice(2));
  console.log(JSON.stringify(run.output, null, 2)); process.exitCode = run.exitCode;
}
