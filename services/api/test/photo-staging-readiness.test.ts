import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseJsonc } from '../scripts/disposable-env.ts';
import { configBody } from '../src/config/dto.ts';
import { photoIntakePolicy } from '../src/reports/photo-policy.ts';

const template = parseJsonc(readFileSync(new URL('../wrangler.photo-staging.example.jsonc', import.meta.url), 'utf8'));
const committed = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('photo staging template has no production fallback, shared resources, secrets or active schedule', () => {
  assert.equal('env' in template, false);
  assert.equal('routes' in template, false);
  assert.equal(template.workers_dev, false);
  assert.equal(template.preview_urls, false);
  assert.notEqual(template.name, committed.env.production.name);
  assert.equal(template.observability.logs.invocation_logs, false);
  assert.deepEqual(template.triggers.crons, []);
  assert.deepEqual(template.vars, { REPORT_ATTESTATION: 'required', REPORT_REGISTRATION: 'paused', PHOTO_EVIDENCE: 'off', REPORT_RETENTION: 'off' });
  assert.deepEqual(template.d1_databases.map((d: any) => [d.binding, d.database_id, d.migrations_dir]), [
    ['DB', '00000000-0000-0000-0000-000000000000', 'migrations'],
    ['REPORTS_DB', '00000000-0000-0000-0000-000000000001', 'migrations-reports'],
  ]);
  assert.deepEqual(template.r2_buckets, [{ binding: 'PRIVATE_PHOTOS', bucket_name: 'mannerpath-photo-staging-private' }]);
  for (const db of template.d1_databases) {
    assert.ok(!committed.env.production.d1_databases.some((p: any) => p.database_id === db.database_id || p.database_name === db.database_name));
  }
  assert.ok(!committed.env.production.r2_buckets.some((b: any) => b.bucket_name === template.r2_buckets[0].bucket_name));
});

test('template cannot enable reports or photos; flags cannot bypass unapproved photo terms', () => {
  assert.equal(configBody(template.vars).reports.available, false);
  assert.equal(photoIntakePolicy(template.vars).enabled, false);
  const configured = {
    ...template.vars,
    PHOTO_EVIDENCE: 'on', REPORT_RETENTION: 'cleanup', REPORT_RETENTION_CRON: '*/5 * * * *',
    PHOTO_STORAGE_POLICY: 'private-no-copies-permanent-fences.v1',
    REPORT_APP_ATTEST_APP_ID: 'ABCDE12345.com.example.mannerpath',
    REPORT_APP_ATTEST_ENVIRONMENT: 'development', REPORT_APP_ATTEST_BUNDLE_VERSIONS: '41',
    REPORT_SUBMITTER_PEPPER: 'x'.repeat(32),
    REPORTS_DB: {} as any, PRIVATE_PHOTOS: { put() {}, head() {} } as any,
  };
  assert.equal(photoIntakePolicy(configured).enabled, false, 'reviewed consent is a separate code/maintainer decision');
  for (const env of [committed, ...Object.values(committed.env)] as any[]) {
    assert.notEqual(env.vars?.PHOTO_EVIDENCE, 'on');
    assert.ok(!(env.r2_buckets ?? []).some((b: any) => b.binding === 'PRIVATE_PHOTOS'));
    assert.deepEqual(env.triggers.crons, []);
  }
});

test('report stream preserves audit and both photo-export fences in sequence', () => {
  const migrations = readdirSync(new URL('../migrations-reports/', import.meta.url)).filter(n => n.endsWith('.sql')).sort();
  assert.deepEqual(migrations.slice(7), ['0008_admin_review_audit.sql', '0009_new_spot_photo_gate.sql', '0010_new_spot_photo_erasure_window.sql']);
});
