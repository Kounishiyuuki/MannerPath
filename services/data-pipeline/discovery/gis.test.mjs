import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDbf, inspectGisPayload, readZipMembers } from './gis.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [], directories = []; let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name), body = Buffer.from(data), crc = crc32(body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, body); directories.push(central, filename); offset += 30 + filename.length + body.length;
  }
  const directory = Buffer.concat(directories), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function dbf() {
  const bytes = Buffer.alloc(65 + 17); bytes[0] = 3; bytes.writeUInt32LE(1, 4); bytes.writeUInt16LE(65, 8); bytes.writeUInt16LE(17, 10);
  bytes.write('category', 32); bytes[43] = 67; bytes[48] = 16; bytes[64] = 13; bytes[65] = 32; bytes.fill(32, 66); bytes.write('smoking area', 66);
  return bytes;
}
test('KMZ reads one bounded KML member without writing paths', () => {
  const result = inspectGisPayload(zip([['../../doc.kml', '<kml/>']]), 'kmz'); assert.equal(result.kml.toString(), '<kml/>');
  assert.throws(() => inspectGisPayload(zip([['a.kml', ''], ['b.kml', '']]), 'kmz'), /exactly one/);
});
test('ZIP bounds, duplicate, checksum, malformed and bomb metadata fail closed', () => {
  assert.throws(() => readZipMembers(Buffer.from('bad')), /ZIP/);
  assert.throws(() => readZipMembers(zip([['a', 'x']]), { maxBytes: 1 }), /limit/);
  assert.throws(() => readZipMembers(zip([['a', 'x'], ['a', 'y']])), /duplicate/);
  const corrupted = zip([['a', 'x']]); corrupted[31] ^= 1; assert.throws(() => readZipMembers(corrupted), /checksum/);
  const bomb = zip([['a', 'x']]); bomb.writeUInt32LE(0xffffffff, 32 + 24); assert.throws(() => readZipMembers(bomb), /limit/);
});
test('DBF attributes preserve category values and enforce record bounds', () => {
  assert.equal(inspectDbf(dbf()).rows[0].category, 'smoking area');
  assert.throws(() => inspectDbf(dbf().subarray(0, 75)), /bounds/);
  assert.throws(() => inspectDbf(dbf(), { maxRows: 0 }), /bounds/);
});
test('SHP ZIP retains PRJ verbatim without inferring coordinates', () => {
  const shp = Buffer.alloc(100); shp.writeInt32BE(9994); shp.writeInt32BE(50, 24); shp.writeInt32LE(1000, 28); shp.writeInt32LE(5, 32);
  const result = inspectGisPayload(zip([['a.dbf', dbf()], ['a.shp', shp], ['a.prj', 'LOCAL_CS["unknown"]']]), 'shp');
  assert.deepEqual(result.geometryTypes, ['Polygon']); assert.equal(result.coordinatesAvailable, false); assert.equal(result.rows[0].properties.category, 'smoking area'); assert.equal(result.possibleCrs[0].definition, 'LOCAL_CS["unknown"]');
});
test('GPKG scans attributes and publisher CRS metadata without decoding geometry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gis-test-')); const path = join(dir, 'test.gpkg');
  try {
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE gpkg_contents(table_name,data_type); CREATE TABLE gpkg_geometry_columns(table_name,column_name,geometry_type_name,srs_id); CREATE TABLE gpkg_spatial_ref_sys(srs_id,organization,organization_coordsys_id,definition); CREATE TABLE points(category TEXT, geom BLOB); INSERT INTO gpkg_contents VALUES('points','features'); INSERT INTO gpkg_geometry_columns VALUES('points','geom','POINT',4326); INSERT INTO gpkg_spatial_ref_sys VALUES(4326,'EPSG',4326,'publisher WKT'); INSERT INTO points VALUES('smoking room',X'00');"); db.close();
    const result = inspectGisPayload(readFileSync(path), 'gpkg'); assert.equal(result.rows[0].properties.category, 'smoking room'); assert.equal(result.coordinatesAvailable, false); assert.equal(result.possibleCrs[0].organization, 'EPSG');
    assert.throws(() => inspectGisPayload(readFileSync(path), 'gpkg', { maxRows: 0 }), /row limit/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GPKG metadata rejects duplicate join keys, excessive layers and views before execution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gis-adversarial-'));
  function payload(name, sql) {
    const path = join(dir, name); const db = new DatabaseSync(path);
    db.exec(sql); db.close(); return readFileSync(path);
  }
  const schema = 'CREATE TABLE gpkg_contents(table_name,data_type); CREATE TABLE gpkg_geometry_columns(table_name,column_name,geometry_type_name,srs_id); CREATE TABLE gpkg_spatial_ref_sys(srs_id,organization,organization_coordsys_id,definition);';
  try {
    // A previous LEFT JOIN would produce 100 million rows from this small file.
    const duplicate = payload('duplicate.gpkg', schema + "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO gpkg_contents SELECT 'points','features' FROM n; WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO gpkg_geometry_columns SELECT 'points','geom','POINT',4326 FROM n;");
    assert.throws(() => inspectGisPayload(duplicate, 'gpkg'), /duplicate/);
    const layers = payload('layers.gpkg', schema + "INSERT INTO gpkg_contents VALUES('a','attributes'),('b','attributes');");
    assert.throws(() => inspectGisPayload(layers, 'gpkg', { maxLayers: 1 }), /layer limit/);
    const view = payload('view.gpkg', "CREATE VIEW gpkg_contents AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT 'points' AS table_name,'features' AS data_type FROM n;");
    assert.throws(() => inspectGisPayload(view, 'gpkg'), /physical tables/);
    const geometryDuplicate = payload('geometry.gpkg', schema + "INSERT INTO gpkg_geometry_columns VALUES('a','geom','POINT',4326),('a','geom','POINT',4326);");
    assert.throws(() => inspectGisPayload(geometryDuplicate, 'gpkg'), /duplicate/);
    const generated = payload('generated.gpkg', "CREATE TABLE gpkg_contents(table_name,data_type); CREATE TABLE gpkg_geometry_columns(table_name,column_name,geometry_type_name,srs_id); CREATE TABLE gpkg_spatial_ref_sys(srs_id,organization,organization_coordsys_id,definition BLOB GENERATED ALWAYS AS (zeroblob(1000000000)) VIRTUAL); INSERT INTO gpkg_spatial_ref_sys(srs_id,organization,organization_coordsys_id) VALUES(4326,'EPSG',4326);");
    assert.throws(() => inspectGisPayload(generated, 'gpkg'), /generated or hidden/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
