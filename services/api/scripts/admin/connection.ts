import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import type { Db } from '../../src/db.ts';
import type { ModerationTarget } from '../../src/reports/moderation-target.ts';
import { REPORT_STORE_SCHEMA } from '../../src/reports/evidence-artifact.ts';
import { R2PrivatePhotoReader, type PrivatePhotoReader } from '../../src/reports/private-photo-view.ts';

/** Same REPORTS_DB identity check as the existing maintainer CLI, before any queue read. */
export async function assertAdminStore(db: Db): Promise<void> {
  const rows = await db.prepare('SELECT key,value FROM report_store_meta').all<{key:string;value:string}>();
  const meta = Object.fromEntries(rows.results.map(r => [r.key,r.value]));
  if (meta.store !== 'mannerpath-reports' || meta.schema !== REPORT_STORE_SCHEMA) throw new Error('reportStoreIdentityMismatch');
  await db.prepare('SELECT operation_id FROM admin_review_audit LIMIT 1').all();
}

/** No connection is opened by parsing flags. Caller must first run moderationTarget with real TTY/CI facts. */
export async function connectAdminStore(target: ModerationTarget, photoBucket?: string) {
  if (photoBucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(photoBucket)) throw new Error('invalidPrivateBucketName');
  const dir = mkdtempSync(join(tmpdir(),'mannerpath-admin-config-'));
  // Config contains resource identifiers only. It never contains credentials, reports or photo bytes.
  const configPath = join(dir,'wrangler.json');
  const config = target.kind === 'remote' ? {
    name:`mannerpath-reports-moderation-${target.environment}`,compatibility_date:'2026-09-01',
    d1_databases:[{binding:'REPORTS_DB',database_name:target.databaseName,database_id:target.databaseId,remote:true}],
    ...(photoBucket ? {r2_buckets:[{binding:'ADMIN_PRIVATE_PHOTOS',bucket_name:photoBucket,remote:true}]} : {}),
  } : null;
  let proxy: Awaited<ReturnType<typeof getPlatformProxy>> | undefined;
  let local: Awaited<ReturnType<typeof getPlatformProxy>> | undefined;
  try {
    if (config) writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
    proxy = await getPlatformProxy({...(config?{configPath,remoteBindings:true,persist:false}:{remoteBindings:false})});
    const reports = proxy.env.REPORTS_DB as Db;
    await assertAdminStore(reports);
    // A remote session has no canonical binding. Duplicates use a separately supplied local snapshot only.
    if(target.kind==='remote')local=await getPlatformProxy({remoteBindings:false});
    const canonical = (local??proxy).env.DB as Db;
    const reader: PrivatePhotoReader | null = photoBucket && target.kind === 'remote'
      ? new R2PrivatePhotoReader(proxy.env.ADMIN_PRIVATE_PHOTOS as ConstructorParameters<typeof R2PrivatePhotoReader>[0]) : null;
    return {reports,canonical,reader,dispose:async()=>{await local?.dispose();await proxy!.dispose();rmSync(dir,{recursive:true,force:true});}};
  } catch {
    await local?.dispose();await proxy?.dispose();rmSync(dir,{recursive:true,force:true});
    throw new Error('adminStoreUnavailableOrMigrationRequired');
  }
}
