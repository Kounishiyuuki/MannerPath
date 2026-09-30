import { inflateRawSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const LIMIT = 32 * 1024 * 1024;
const fail = (message) => { throw new Error(`GIS payload: ${message}`); };
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = (n >>> 8) ^ crcTable[(n ^ b) & 255];
  return (n ^ 0xffffffff) >>> 0;
}

/** Read in memory only: no archive path is ever written to disk. ZIP64 is refused. */
export function readZipMembers(input, { maxBytes = LIMIT, maxMembers = 256 } = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length > maxBytes) fail('archive exceeds byte limit');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) fail('missing ZIP end directory');
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || count !== bytes.readUInt16LE(end + 8)) fail('split ZIP unsupported');
  if (count === 65535 || count > maxMembers || size === 0xffffffff || cursor + size !== end) fail('invalid or excessive ZIP directory');
  const members = new Map();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('invalid ZIP member');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20), expanded = bytes.readUInt32LE(cursor + 24);
    const nameLen = bytes.readUInt16LE(cursor + 28), extraLen = bytes.readUInt16LE(cursor + 30), commentLen = bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLen + extraLen + commentLen > end) fail('truncated ZIP directory');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    if (flags & 1 || ![0, 8].includes(method)) fail('encrypted or unsupported ZIP compression');
    total += expanded;
    if (expanded === 0xffffffff || total > maxBytes || (compressed === 0 && expanded > 0) || expanded > Math.max(1024 * 1024, compressed * 200)) fail('ZIP expansion limit');
    if (members.has(name)) fail('duplicate ZIP member');
    if (offset + 30 > cursor || bytes.readUInt32LE(offset) !== 0x04034b50) fail('invalid ZIP local header');
    if (bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method) fail('ZIP header mismatch');
    const localNameLen = bytes.readUInt16LE(offset + 26), localExtra = bytes.readUInt16LE(offset + 28);
    if (bytes.subarray(offset + 30, offset + 30 + localNameLen).toString('utf8') !== name) fail('ZIP member name mismatch');
    const start = offset + 30 + localNameLen + localExtra;
    if (start + compressed > bytes.readUInt32LE(end + 16)) fail('truncated ZIP member');
    const raw = bytes.subarray(start, start + compressed);
    const body = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: maxBytes });
    if (body.length !== expanded || crc32(body) !== bytes.readUInt32LE(cursor + 16)) fail('ZIP size/checksum mismatch');
    members.set(name, body);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  if (cursor !== end) fail('ZIP directory size mismatch');
  return members;
}

export function inspectDbf(input, { encoding = 'shift_jis', maxRows = 100000 } = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length < 33) fail('truncated DBF');
  const count = bytes.readUInt32LE(4), header = bytes.readUInt16LE(8), length = bytes.readUInt16LE(10);
  if (count > maxRows || header < 33 || header > bytes.length || length < 1 || header + count * length > bytes.length) fail('invalid DBF bounds');
  const decoder = new TextDecoder(encoding, { fatal: true });
  const fields = [];
  let offset = 1, p = 32;
  for (; p + 32 <= header && bytes[p] !== 13; p += 32) {
    const name = decoder.decode(bytes.subarray(p, p + 11)).replace(/\0.*$/s, '').trim();
    const size = bytes[p + 16];
    if (!name || !size || fields.some(f => f.name === name)) fail('invalid DBF field');
    fields.push({ name, size, offset }); offset += size;
  }
  if (bytes[p] !== 13 || offset > length) fail('invalid DBF fields');
  const rows = [];
  for (let i = 0; i < count; i++) {
    const start = header + i * length;
    if (bytes[start] === 42) continue;
    if (bytes[start] !== 32) fail('invalid DBF deletion marker');
    rows.push(Object.fromEntries(fields.map(f => [f.name, decoder.decode(bytes.subarray(start + f.offset, start + f.offset + f.size)).trim()])));
  }
  return { rows, rowCount: count, deletedRows: count - rows.length, encoding };
}

const quote = value => `"${value.replaceAll('"', '""')}"`;
export function inspectGpkg(input, { maxRows = 100000, maxBytes = LIMIT, maxLayers = 256 } = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length > maxBytes || bytes.subarray(0, 16).toString() !== 'SQLite format 3\0') fail('invalid or excessive GPKG');
  const dir = mkdtempSync(join(tmpdir(), 'mannerpath-discovery-'));
  let db;
  try {
    const path = join(dir, 'payload.gpkg'); writeFileSync(path, bytes);
    db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    // Never join untrusted metadata: duplicate names could multiply a tiny file
    // into billions of result rows. Refuse views before executing their SQL.
    function metadata(table, columns, key, limit) {
      const object = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(table);
      if (object?.type !== 'table' || !/^CREATE\s+TABLE\b/i.test(object.sql ?? '')) fail('GPKG metadata must be physical tables');
      // Generated columns execute expressions when selected, even on a physical
      // table. Inspect declarations without evaluating any stored expression.
      if (db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all().some(column => column.hidden !== 0)) fail('GPKG generated or hidden columns unsupported');
      const records = new Map();
      for (const row of db.prepare(`SELECT ${columns} FROM ${quote(table)} LIMIT ?`).all(limit + 1)) {
        if (records.size >= limit) fail('GPKG metadata layer limit');
        if (row[key] == null || records.has(row[key])) fail('duplicate or missing GPKG metadata key');
        records.set(row[key], row);
      }
      return records;
    }
    const contents = metadata('gpkg_contents', 'table_name,data_type', 'table_name', maxLayers);
    const geometries = metadata('gpkg_geometry_columns', 'table_name,column_name,geometry_type_name,srs_id', 'table_name', maxLayers);
    const references = metadata('gpkg_spatial_ref_sys', 'srs_id,organization,organization_coordsys_id,definition', 'srs_id', 4096);
    const layers = [...contents.values()].sort((a, b) => String(a.table_name).localeCompare(String(b.table_name))).map(c => ({ ...c, ...geometries.get(c.table_name) }));
    const rows = [], geometryTypes = new Set(), possibleCrs = [];
    let rowCount = 0;
    for (const layer of layers) {
      if (!['features', 'attributes'].includes(layer.data_type)) continue;
      const object = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(layer.table_name);
      if (typeof layer.table_name !== 'string' || object?.type !== 'table' || !/^CREATE\s+TABLE\b/i.test(object.sql ?? '')) fail('GPKG layer must be physical table');
      if (db.prepare(`PRAGMA table_xinfo(${quote(layer.table_name)})`).all().some(column => column.hidden !== 0)) fail('GPKG generated or hidden columns unsupported');
      const count = Number(db.prepare(`SELECT count(*) AS n FROM ${quote(layer.table_name)}`).get().n);
      rowCount += count;
      if (rowCount > maxRows) fail('GPKG row limit');
      const columns = db.prepare(`PRAGMA table_info(${quote(layer.table_name)})`).all().map(c => c.name).filter(n => n !== layer.column_name);
      if (columns.length) rows.push(...db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(layer.table_name)}`).all().map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? String(v) : Buffer.isBuffer(v) || v instanceof Uint8Array ? '[binary]' : v]))));
      if (layer.geometry_type_name) geometryTypes.add(layer.geometry_type_name);
      if (layer.srs_id != null) possibleCrs.push(references.get(layer.srs_id) ?? { srs_id: layer.srs_id });
    }
    return { rows: rows.map(properties => ({ properties })), rowCount, geometryTypes: [...geometryTypes], possibleCrs, coordinatesAvailable: false, notes: ['Geometry bytes deliberately not decoded; coordinate and point semantics need individual review.'] };
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
}

export function inspectGisPayload(bytes, format, options = {}) {
  format = format.toLowerCase();
  if (format === 'gpkg') return inspectGpkg(bytes, options);
  const members = readZipMembers(bytes, options);
  if (format === 'kmz') {
    const kml = [...members].filter(([name]) => /\.kml$/i.test(name));
    if (kml.length !== 1) fail('KMZ requires exactly one KML member');
    return { kml: kml[0][1], member: kml[0][0] };
  }
  const dbfs = [...members].filter(([name]) => /\.dbf$/i.test(name));
  if (!dbfs.length) fail('SHP ZIP lacks DBF attributes');
  const rows = [], geometryTypes = new Set(), possibleCrs = [];
  let rowCount = 0;
  for (const [name, body] of dbfs) {
    const parsed = inspectDbf(body, options); rows.push(...parsed.rows); rowCount += parsed.rowCount;
    if (rowCount > (options.maxRows ?? 100000)) fail('SHP row limit');
    const base = name.slice(0, -4).toLowerCase();
    const shp = [...members].find(([n]) => n.toLowerCase() === `${base}.shp`);
    if (shp) {
      const data = shp[1];
      if (data.length < 100 || data.readInt32BE(0) !== 9994 || data.readInt32LE(28) !== 1000 || data.readInt32BE(24) * 2 !== data.length) fail('invalid SHP header');
      geometryTypes.add(({ 0: 'Null', 1: 'Point', 3: 'Polyline', 5: 'Polygon', 8: 'MultiPoint', 11: 'PointZ', 21: 'PointM' })[data.readInt32LE(32)] ?? `SHP:${data.readInt32LE(32)}`);
    }
    const prj = [...members].find(([n]) => n.toLowerCase() === `${base}.prj`);
    if (prj) possibleCrs.push({ member: prj[0], definition: new TextDecoder('utf-8', { fatal: true }).decode(prj[1]) });
  }
  return { rows: rows.map(properties => ({ properties })), rowCount, geometryTypes: [...geometryTypes], possibleCrs, coordinatesAvailable: false, notes: ['SHP attributes only; PRJ retained verbatim, CRS never inferred.'] };
}
