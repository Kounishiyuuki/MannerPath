// Validate canonical tile storage one bounded part at a time; never assemble a multipart INSERT.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { validateSnapshots } from "../src/pipeline/promotion.ts";
import { TileBodyV1, TileManifestV2, TilePartBodyV2 } from "../src/tiles/dto.ts";
import { TILE_PART_POLICY, TILE_MANIFEST_MAX_BYTES, sqlLiteralBytes } from "../src/tiles/parts.ts";
import { D1_CAPACITY_POLICY, type PromotionV4Manifest } from "./promotion-v4-format.ts";

type Row = Record<string, unknown>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function refuse(message: string): never { throw new Error(`v4 tile integrity: ${message}`); }
export async function validateV4Tile(db: DatabaseSync, tile: Row, sources: Row[]): Promise<PromotionV4Manifest["tiles"][number]> {
  const tileId = String(tile.tile_id), stored = String(tile.body_json);
  if (Buffer.byteLength(stored) >= D1_CAPACITY_POLICY.statementBytes || hash(stored) !== tile.content_sha256) refuse("head bytes/hash mismatch");
  const schemaVersion = Number(tile.schema_version);
  const declaration: PromotionV4Manifest["tiles"][number] = { tileId, revision: Number(tile.revision), spotCount: Number(tile.spot_count), contentSha256: String(tile.content_sha256), schemaVersion: schemaVersion as 1 | 2, parts: [] };
  const membershipCount = Number((db.prepare("SELECT count(*) n FROM tile_snapshot_spots WHERE tile_id=?").get(tileId) as { n: number }).n);
  if (membershipCount !== tile.spot_count) refuse("logical membership count mismatch");
  let previousId = "", total = 0;
  async function validateBody(body: TileBodyV1): Promise<void> {
    const members: Row[] = [], spots: Row[] = [];
    for (const spot of body.spots) {
      if (spot.id <= previousId) refuse("duplicate or unordered logical spots");
      previousId = spot.id; total++;
      const member = db.prepare("SELECT * FROM tile_snapshot_spots WHERE spot_id=? AND tile_id=?").get(spot.id, tileId) as Row | undefined;
      const canonical = db.prepare("SELECT * FROM spots WHERE spot_id=?").get(spot.id) as Row | undefined;
      if (!member || !canonical) refuse("canonical spot/membership missing");
      members.push(member); spots.push(canonical);
    }
    const referenced = [...new Set(body.spots.flatMap(s => s.sourceIds))].sort();
    if (JSON.stringify(body.sources.map(s => s.id)) !== JSON.stringify(referenced)) refuse("source reference set mismatch");
    for (const s of body.sources) {
      const source = sources.find(row => row.source_id === s.id);
      if (!source || s.displayName !== source.display_name || s.licenseName !== source.license_name || s.licenseUrl !== source.license_url || s.attributionText !== source.attribution_text) refuse("canonical source metadata mismatch");
    }
    const json = JSON.stringify(body);
    await validateSnapshots(new Map([["sources", sources], ["spots", spots], ["tile_snapshot_spots", members], ["tile_snapshots", [{ ...tile, schema_version: 1, spot_count: body.spots.length, content_sha256: hash(json), body_json: json }]]]));
  }
  if (schemaVersion === 1) {
    if (db.prepare("SELECT 1 FROM tile_snapshot_parts WHERE tile_id=? LIMIT 1").get(tileId)) refuse("v1 head has part rows");
    const body = TileBodyV1.parse(JSON.parse(stored));
    if (body.tile !== tileId || body.revision !== tile.revision || body.generatedAt !== tile.published_at) refuse("v1 head identity mismatch");
    await validateBody(body);
  } else if (schemaVersion === 2) {
    const manifest = TileManifestV2.parse(JSON.parse(stored));
    if (manifest.tile !== tileId || manifest.revision !== tile.revision || manifest.generatedAt !== tile.published_at || manifest.spotCount !== tile.spot_count || manifest.partPolicy !== TILE_PART_POLICY.version || manifest.parts.length > TILE_PART_POLICY.maxParts || sqlLiteralBytes(stored) > TILE_MANIFEST_MAX_BYTES) refuse("manifest/head identity or capacity mismatch");
    let index = 0;
    for (const part of db.prepare("SELECT * FROM tile_snapshot_parts WHERE tile_id=? ORDER BY part_index").iterate(tileId)) {
      const expected = manifest.parts[index];
      if (!expected || part.part_index !== index || part.tile_id !== tileId || part.content_sha256 !== expected.sha256 || part.spot_count !== expected.spotCount) refuse("extra/misindexed part or descriptor mismatch");
      const text = String(part.body_json);
      if (sqlLiteralBytes(text) > TILE_PART_POLICY.maxRawBytes || hash(text) !== expected.sha256) refuse("part byte budget/hash mismatch");
      const body = TilePartBodyV2.parse(JSON.parse(text));
      if (body.tile !== tileId || body.part !== index || body.partCount !== manifest.parts.length || body.spots.length !== expected.spotCount || body.spots.length > TILE_PART_POLICY.maxSpots) refuse("part identity/count mismatch");
      declaration.parts.push({ partIndex: index, spotCount: body.spots.length, contentSha256: expected.sha256 });
      await validateBody({ schemaVersion: 1, tile: tileId, revision: manifest.revision, generatedAt: manifest.generatedAt, spots: body.spots, sources: body.sources });
      index++;
    }
    if (index !== manifest.parts.length) refuse("missing part");
  } else refuse("unsupported head schema");
  if (total !== tile.spot_count) refuse("incomplete logical tile");
  return declaration;
}
