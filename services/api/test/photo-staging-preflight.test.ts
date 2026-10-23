import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parsePreflightJsonc, photoStagingPreflight, runPhotoStagingPreflight, migrationNamesValid } from '../scripts/photo-staging-preflight.ts';

const api = fileURLToPath(new URL('..', import.meta.url));
const prod = (parsePreflightJsonc(readFileSync(resolve(api, 'wrangler.jsonc'), 'utf8')) as any).env.production;
const origins = ['https://production.example.com'];
function fixture(t: any) {
  const dir = mkdtempSync(resolve(tmpdir(), 'photo-preflight-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config: any = parsePreflightJsonc(readFileSync(resolve(api, 'wrangler.photo-staging.example.jsonc'), 'utf8'));
  config.main = resolve(api, 'src/index.ts');
  config.d1_databases[0].database_id = '11111111-1111-4111-8111-111111111111';
  config.d1_databases[1].database_id = '22222222-2222-4222-8222-222222222222';
  config.d1_databases[0].migrations_dir = resolve(api, 'migrations');
  config.d1_databases[1].migrations_dir = resolve(api, 'migrations-reports');
  const path = resolve(dir, 'worker.jsonc');
  const save = () => writeFileSync(path, JSON.stringify(config));
  save();
  return { dir, path, config, save, run: (inventory = origins) => { save(); return photoStagingPreflight({ configPath: path, productionOrigins: inventory }); } };
}

test('valid disabled initial configuration passes offline only; unknown cloud facts always block execution', t => {
  const f = fixture(t); const before = readFileSync(f.path);
  const output = f.run();
  assert.equal(output.offlineStatus, 'PASS');
  assert.equal(output.executionStatus, 'BLOCKED');
  assert.ok(output.checks.every(c => c.status === 'PASS'));
  assert.ok(output.operatorChecks.some(c => /ownership/.test(c)));
  assert.ok(output.operatorChecks.every(c => c.includes('NOT VERIFIED')));
  assert.deepEqual(readFileSync(f.path), before);
  assert.deepEqual(readdirSync(f.dir), ['worker.jsonc']);
  assert.equal(runPhotoStagingPreflight(['--config', f.path, '--production-origin', origins[0]]).exitCode, 0);
});

const cases: [string, (c: any) => void][] = [
  ['production Worker', c => { c.name = prod.name; }],
  ['production canonical ID', c => { c.d1_databases[0].database_id = prod.d1_databases[0].database_id; }],
  ['production report ID case variant', c => { c.d1_databases[1].database_id = prod.d1_databases[1].database_id.toUpperCase(); }],
  ['cross-binding production ID', c => { c.d1_databases[0].database_id = prod.d1_databases[1].database_id; }],
  ['production DB name', c => { c.d1_databases[0].database_name = prod.d1_databases[0].database_name; }],
  ['shared DB ID', c => { c.d1_databases[1].database_id = c.d1_databases[0].database_id; }],
  ['shared DB name', c => { c.d1_databases[1].database_name = c.d1_databases[0].database_name; }],
  ['placeholder DB', c => { c.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000'; }],
  ['placeholder reports', c => { c.d1_databases[1].database_id = '00000000-0000-0000-0000-000000000001'; }],
  ['missing REPORTS_DB', c => { c.d1_databases.pop(); }],
  ['missing canonical DB', c => { c.d1_databases.shift(); }],
  ['unsupported DATA_DB alias', c => { c.d1_databases[0].binding = 'DATA_DB'; }],
  ['duplicate binding', c => { c.d1_databases[1].binding = 'DB'; }],
  ['extra database', c => { c.d1_databases.push({ ...c.d1_databases[0], binding: 'OTHER' }); }],
  ['missing private photos', c => { c.r2_buckets = []; }],
  ['production bucket', c => { c.r2_buckets[0].bucket_name = prod.r2_buckets[0].bucket_name; }],
  ['extra R2 binding', c => { c.r2_buckets.push({ binding: 'RAW_ARTIFACTS', bucket_name: prod.r2_buckets[0].bucket_name }); }],
  ['preview bucket alias', c => { c.r2_buckets[0].preview_bucket_name = prod.r2_buckets[0].bucket_name; }],
  ['remote binding override', c => { c.d1_databases[0].remote = true; }],
  ['App Attest disabled', c => { c.vars.REPORT_ATTESTATION = 'disabled'; }],
  ['registration enabled', c => { c.vars.REPORT_REGISTRATION = 'enabled'; }],
  ['photo intake on without reviewed terms', c => { c.vars.PHOTO_EVIDENCE = 'on'; }],
  ['photo intake unknown', c => { c.vars.PHOTO_EVIDENCE = 'unknown'; }],
  ['missing registration state', c => { delete c.vars.REPORT_REGISTRATION; }],
  ['retention cleanup on initially', c => { c.vars.REPORT_RETENTION = 'cleanup'; }],
  ['active cron', c => { c.triggers.crons = ['*/5 * * * *']; }],
  ['missing cron declaration', c => { delete c.triggers; }],
  ['workers.dev bypass', c => { c.workers_dev = true; }],
  ['preview URL bypass', c => { c.preview_urls = true; }],
  ['invocation URL logging', c => { c.observability.logs.invocation_logs = true; }],
  ['production env fallback', c => { c.env = { production: prod }; }],
  ['service fallback', c => { c.services = [{ binding: 'FALLBACK', service: prod.name }]; }],
  ['production origin alias', c => { c.vars.API_ORIGIN = origins[0]; }],
  ['build execution override', c => { c.build = { command: 'do-not-execute' }; }],
  ['unknown future option', c => { c.unrecognized = true; }],
  ['route shorthand', c => { c.route = 'production.example.com/*'; }],
  ['wildcard route', c => { c.routes = [{ pattern: '*.example.com/*', custom_domain: true }]; }],
  ['production route', c => { c.routes = [{ pattern: 'production.example.com', custom_domain: true }]; }],
  ['production subdomain route', c => { c.routes = [{ pattern: 'staging.production.example.com', custom_domain: true }]; }],
  ['production parent route', c => { c.routes = [{ pattern: 'example.com', custom_domain: true }]; }],
  ['nonstaging custom domain', c => { c.routes = [{ pattern: 'unreviewed.example.net', custom_domain: true }]; }],
  ['alternate entrypoint', c => { c.main = resolve(api, 'src/app.ts'); }],
  ['unsupported compatibility', c => { c.compatibility_date = '2099-01-01'; }],
  ['canonical/report streams swapped', c => { [c.d1_databases[0].migrations_dir, c.d1_databases[1].migrations_dir] = [c.d1_databases[1].migrations_dir, c.d1_databases[0].migrations_dir]; }],
];
for (const [name, change] of cases) test(`BLOCKED: ${name}`, t => {
  const f = fixture(t); change(f.config);
  const out = f.run(); assert.equal(out.offlineStatus, 'BLOCKED'); assert.equal(out.executionStatus, 'BLOCKED');
});

test('routes accept only declared exact disjoint staging custom domains; origin inventory cannot be omitted or malformed', t => {
  const f = fixture(t); f.config.routes = [{ pattern: 'photo-staging.example.net', custom_domain: true }];
  assert.equal(f.run().offlineStatus, 'PASS');
  for (const inventory of [[], ['not-an-origin'], ['http://production.example.com'], ['https://production.example.com/path'], ['https://user:pass@production.example.com'], ['https://production.example.com?key=x']]) assert.equal(f.run(inventory).offlineStatus, 'BLOCKED');
  assert.equal(f.run(['https://PHOTO-STAGING.EXAMPLE.NET']).offlineStatus, 'BLOCKED');
});

test('migration directories resolve relative to config, and missing, reordered or changed files block', t => {
  const f = fixture(t);
  cpSync(resolve(api, 'migrations-reports'), resolve(f.dir, 'reports'), { recursive: true });
  f.config.d1_databases[1].migrations_dir = './reports';
  assert.equal(f.run().offlineStatus, 'PASS');
  const migration=resolve(f.dir, 'reports/0010_new_spot_photo_erasure_window.sql');
  const bytes=readFileSync(migration);bytes[0]=bytes[0]===45?32:45;writeFileSync(migration,bytes);
  assert.equal(f.run().offlineStatus, 'BLOCKED');
  writeFileSync(migration, '-- tampered');
  assert.equal(f.run().offlineStatus, 'BLOCKED');
  rmSync(resolve(f.dir, 'reports/0010_new_spot_photo_erasure_window.sql'));
  assert.equal(f.run().offlineStatus, 'BLOCKED');
  writeFileSync(resolve(f.dir, 'reports/0011_new_spot_photo_erasure_window.sql'), '-- wrong order');
  assert.equal(f.run().offlineStatus, 'BLOCKED');
});

test('strict parser rejects ambiguity including escaped duplicate keys and malformed JSONC', () => {
  assert.deepEqual(parsePreflightJsonc('/* comment */ {"x": [true, null, 1], "url": "https://example.com"} // end'), { x: [true, null, 1], url: 'https://example.com' });
  for (const s of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"nested":{"x":1,"x":2}}', '{"x":1,}', '[]{}', '/* unclosed', '{', '[,]', 'undefined']) assert.throws(() => parsePreflightJsonc(s));
});

test('CLI output is redacted for malformed, unknown, secret-bearing and missing inputs; no actions are accepted', t => {
  const f = fixture(t); const sensitive = 'private-marker-' + 'q'.repeat(50);
  const cli = resolve(api, 'scripts/photo-staging-preflight.ts');
  for (const text of ['{ "bad": "' + sensitive + '"', JSON.stringify({ ...f.config, vars: { ...f.config.vars, credential: sensitive } }), '{"name":1,"name":2}']) {
    writeFileSync(f.path, text);
    const out = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, '--config', f.path, '--production-origin', origins[0]], { encoding: 'utf8' });
    assert.equal(out.status, 2); assert.equal(out.stderr, '');
    assert.ok(!out.stdout.includes(sensitive)); assert.ok(!out.stdout.includes(f.path));
    assert.equal(JSON.parse(out.stdout).offlineStatus, 'BLOCKED');
  }
  for (const args of [[], ['--remote', sensitive], ['--deploy', sensitive], ['--env', 'production'], ['--config', f.path, '--config', f.path], ['--config', sensitive]]) {
    const run = runPhotoStagingPreflight(args); assert.equal(run.exitCode, 2); assert.ok(!JSON.stringify(run.output).includes(sensitive));
  }
  f.save();
  const out = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, '--config', f.path, '--production-origin', origins[0]], { encoding: 'utf8' });
  assert.equal(out.status, 0); assert.equal(JSON.parse(out.stdout).executionStatus, 'BLOCKED');
});


test('CR and CRLF comments cannot conceal duplicate keys, activation or unknown configuration', t => {
  const f = fixture(t);
  for (const newline of ['\r', '\r\n', '\n']) {
    const duplicate = '{"PHOTO_EVIDENCE":"off"// comment' + newline + ',"PHOTO_EVIDENCE":"on"\n}';
    assert.throws(() => parsePreflightJsonc(duplicate));
    const hidden = JSON.stringify(f.config).slice(0, -1) + '// comment' + newline + ',"env":{"production":{}}\n}';
    writeFileSync(f.path, hidden);
    assert.equal(photoStagingPreflight({configPath:f.path,productionOrigins:origins}).offlineStatus,'BLOCKED');
    assert.deepEqual(parsePreflightJsonc('{"x":1// comment' + newline + '}'),{x:1});
  }
});

test('mandatory report migrations cannot disappear from both configured and reference lists', () => {
  const names = readdirSync(resolve(api,'migrations-reports')).sort();
  assert.equal(migrationNamesValid(names,names,true),true);
  for(const required of ['0008_admin_review_audit.sql','0009_new_spot_photo_gate.sql','0010_new_spot_photo_erasure_window.sql']){
    const missing=names.filter(n=>n!==required);
    assert.equal(migrationNamesValid(missing,missing,true),false);
  }
});

test('bounded reads, deep input, credential-file paths and bootstrap-only streams fail closed with redacted output', t => {
  const f=fixture(t);const sensitive='private-marker-'+'q'.repeat(50);
  for(const text of [' '.repeat(262145), '['.repeat(34)+'0'+']'.repeat(34)]){
    writeFileSync(f.path,text);
    assert.equal(photoStagingPreflight({configPath:f.path,productionOrigins:origins}).offlineStatus,'BLOCKED');
  }
  assert.equal(photoStagingPreflight({configPath:f.dir,productionOrigins:origins}).offlineStatus,'BLOCKED');
  const credential=resolve(f.dir,'.env');writeFileSync(credential,sensitive);
  symlinkSync(credential,resolve(f.dir,'symlink.jsonc'));
  for(const configPath of [credential,resolve(f.dir,'symlink.jsonc')])assert.equal(photoStagingPreflight({configPath,productionOrigins:origins}).offlineStatus,'BLOCKED');
  for(const field of ['main','migrations_dir','origin']){
    const original=structuredClone(f.config);
    if(field==='main')f.config.main=sensitive;
    else if(field==='migrations_dir')f.config.d1_databases[1].migrations_dir=sensitive;
    const output=f.run(field==='origin'?['https://'+sensitive+'@example.com']:origins);
    assert.equal(output.offlineStatus,'BLOCKED');assert.ok(!JSON.stringify(output).includes(sensitive));
    Object.assign(f.config,original);
  }
  const bootstrap=resolve(f.dir,'bootstrap');cpSync(resolve(api,'migrations-reports'),bootstrap,{recursive:true});
  for(const n of readdirSync(bootstrap).slice(2))rmSync(resolve(bootstrap,n));
  f.config.d1_databases[1].migrations_dir=bootstrap;
  assert.equal(f.run().checks.find(c=>c.id==='reports_db-migrations')?.status,'BLOCKED');
});

test('specific checks report intended failures rather than relying on other BLOCKED findings', t=>{
  const f=fixture(t);
  f.config.d1_databases[1].database_id=prod.d1_databases[0].database_id;
  assert.equal(f.run().checks.find(c=>c.id==='database-identities')?.status,'BLOCKED');
  f.config.d1_databases[1].database_id='22222222-2222-4222-8222-222222222222';
  f.config.vars.PHOTO_EVIDENCE='on';
  assert.equal(f.run().checks.find(c=>c.id==='initial-policy')?.status,'BLOCKED');
  f.config.vars.PHOTO_EVIDENCE='off';f.config.routes=[{pattern:'staging.production.example.com',custom_domain:true}];
  assert.equal(f.run().checks.find(c=>c.id==='routes-isolation')?.status,'BLOCKED');
});


test('documented npm silent invocation does not echo rejected credential-bearing origin or config path', t=>{
  const f=fixture(t);const sensitive='private-marker-'+'q'.repeat(50);
  const out=spawnSync('npm',['run','--silent','photo-staging:preflight','--','--config',f.path,'--production-origin','https://user:'+sensitive+'@example.com'],{cwd:api,encoding:'utf8'});
  assert.equal(out.status,2);assert.equal(out.stderr,'');
  assert.ok(!out.stdout.includes(sensitive));assert.ok(!out.stdout.includes(f.path));
  assert.equal(JSON.parse(out.stdout).offlineStatus,'BLOCKED');
});
