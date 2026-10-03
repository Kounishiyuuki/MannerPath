import { areaPipeline, exactChain } from "./support/area.ts";
const { db, adapter } = await areaPipeline();
const id = await exactChain(db, adapter);
console.log(db.raw.prepare("SELECT seq, kind, precision, evidence_release_id, evidence_record_id, latitude, longitude FROM spot_location_authorities WHERE spot_id = ?").all(id));
console.log(db.raw.prepare("SELECT latitude, longitude FROM spots WHERE spot_id = ?").get(id));
