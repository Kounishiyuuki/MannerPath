// Disposable synthetic examples only. The real migrations are shared with the test D1 adapter;
// no report or image is written to disk and no production connection is imported here.
import { encode } from 'fast-png';
import { reportsD1, SqliteD1 } from '../../test/support/sqlite-d1.ts';
import { createReport } from '../../src/reports/create.ts';
import { CURRENT_REPORT_TERMS } from '../../src/reports/terms.ts';
import { attachEvidencePhoto } from '../../src/reports/photos.ts';
import { MemoryEvidencePhotoStorage } from '../../src/reports/photo-storage.ts';
import type { PrivatePhotoReader } from '../../src/reports/private-photo-view.ts';

export async function createAdminDemo(now=new Date()) {
  const reports=reportsD1();const canonical=new SqliteD1();const storage=new MemoryEvidencePhotoStorage();
  const ids:string[]=[];const names=['サンプル・駅前の指定喫煙所','サンプル・施設内の喫煙室','サンプル・写真アップロード未完了'];
  for(let i=0;i<3;i++){
    const at=new Date(now.getTime()-(i===2?20:i+1)*60_000);const submitterHash=String(i+1).repeat(64);
    const report=await createReport(reports,{schemaVersion:1,type:'missing',installId:crypto.randomUUID(),acceptedTermsVersion:CURRENT_REPORT_TERMS.version,
      proposedLocation:{latitude:35.714+i*.00015,longitude:139.777+i*.0001},note:'デモ用の架空投稿です。現地の喫煙許可を示すものではありません。',
      claim:{spotType:i===1?'facilitySmokingRoom':'designatedOutdoorArea',accessType:i===1?'facilityOnly':'public',environment:i===1?'indoor':'outdoor',supportsPaper:'unknown',supportsHeated:'unknown',hostName:names[i],hoursNote:i===1?'施設の営業時間内（要確認）':'投稿者は 8:00–20:00 と記載（要確認）'}},
      {now:at,attestationStatus:'verified',submitterHash});
    ids.push(report.reportId);
    const width=480,height=300;const data=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4;const checker=((Math.floor(x/40)+Math.floor(y/40))%2)*24;
      data[p]=80+i*30+checker;data[p+1]=140+checker;data[p+2]=130+i*25;data[p+3]=255;
    }
    const put=storage.put.bind(storage);
    if(i===2)storage.put=async()=>{throw new Error('syntheticUploadFailure');};
    try{await attachEvidencePhoto(reports,storage,{reportId:report.reportId,submitterHash,idempotencyKey:crypto.randomUUID(),acceptedTermsVersion:CURRENT_REPORT_TERMS.version,
      bytes:encode({width,height,channels:4,data}),mediaType:'image/png'},{now:at,enabled:true,photoTermsCovered:()=>true});}
    catch{if(i!==2)throw new Error('demoSetupFailed');}
    storage.put=put;
  }
  canonical.raw.prepare(`INSERT INTO spots(spot_id,name,latitude,longitude,tile_z,tile_x,tile_y,tile_id,spot_type,lifecycle,evidence_quality,evidence_quality_version,resolver_version,created_at,updated_at)
    VALUES('sp_demo_existing','サンプル・既存候補（未公開）',35.7141,139.7771,14,14553,6449,'14/14553/6449','designatedOutdoorArea','active','unknown','demo','demo',?,?)`).run(now.toISOString(),now.toISOString());
  const reader:PrivatePhotoReader={read:async(key,max)=>{const bytes=storage.objects.get(key)?.bytes;if(!bytes)return null;if(bytes.length>max)throw new Error('photoTooLarge');return bytes.slice();}};
  return {reports,canonical,reader,ids,dispose:async()=>{storage.objects.clear();reports.raw.close();canonical.raw.close();}};
}
