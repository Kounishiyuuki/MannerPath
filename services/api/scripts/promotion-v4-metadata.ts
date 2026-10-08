// One bounded metadata shard is resident at a time. Legacy inline v4 remains readable.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { lstat, readdir, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson, D1_CAPACITY_POLICY, TILE_METADATA_MAX_BYTES, type PromotionV4Manifest, type V4Tile, type V4TileDeclarations } from "./promotion-v4-format.ts";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const tileDeclarationSchema = z.object({
  tileId: z.string().min(1), revision: integer.min(1), spotCount: integer, contentSha256: digest,
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  parts: z.array(z.object({ partIndex: integer.max(127), spotCount: integer.min(1).max(250), contentSha256: digest }).strict()).max(128),
}).strict();
export const tileDeclarationsSchema = z.object({
  version: z.literal("promotion-tile-declarations.v1"), tileCount: integer.min(1), partCount: integer,
  shards: z.array(z.object({ ordinal: integer.min(1), file: z.string(), sha256: digest,
    bytes: integer.min(1).max(TILE_METADATA_MAX_BYTES), tileCount: integer.min(1), partCount: integer,
    firstTileId: z.string().min(1), lastTileId: z.string().min(1) }).strict()).min(1),
}).strict();
function validateTile(tile: V4Tile): void {
  if (tile.schemaVersion === 1 && tile.parts.length !== 0 || tile.schemaVersion === 2 &&
    (tile.parts.some((p, i) => p.partIndex !== i) || tile.parts.reduce((n, p) => n + p.spotCount, 0) !== tile.spotCount)) {
    throw Error("v4: incomplete or inconsistent tile parts declaration");
  }
}
export function validateTileMetadataManifest(manifest: PromotionV4Manifest): void {
  const metadata = manifest.tileDeclarations;
  if (!metadata) {
    if (new Set(manifest.tiles.map(t => t.tileId)).size !== manifest.tiles.length) throw Error("v4: duplicate tile declaration");
    for (const tile of manifest.tiles) validateTile(tile);
    return;
  }
  if (manifest.tiles.length) throw Error("v4: inline and segmented tile declarations cannot coexist");
  let tileCount = 0, partCount = 0, last = "";
  for (const [i, shard] of metadata.shards.entries()) {
    if (shard.ordinal !== i + 1 || shard.file !== `tile-metadata-${shard.sha256}.json` || shard.firstTileId > shard.lastTileId || shard.firstTileId <= last) throw Error("v4: metadata shard ordering/path mismatch");
    last = shard.lastTileId; tileCount += shard.tileCount; partCount += shard.partCount;
  }
  if (tileCount !== metadata.tileCount || partCount !== metadata.partCount || tileCount !== manifest.rows.tile_snapshots || partCount !== (manifest.rows.tile_snapshot_parts ?? 0)) throw Error("v4: metadata declaration counts mismatch");
}
export async function* iterateV4Tiles(directory: string, manifest: PromotionV4Manifest): AsyncGenerator<V4Tile> {
  validateTileMetadataManifest(manifest);
  const metadata = manifest.tileDeclarations;
  const actual = (await readdir(directory)).filter(f => f.startsWith("tile-metadata-")).sort();
  const expected = (metadata?.shards.map(s => s.file) ?? []).sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw Error("v4: missing or extra tile metadata artifact");
  if (!metadata) { yield* manifest.tiles; return; }
  let previous = "", tileCount = 0, partCount = 0;
  for (const shard of metadata.shards) {
    const path = join(directory, shard.file), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== shard.bytes || stat.size > TILE_METADATA_MAX_BYTES) throw Error("v4: missing/oversized metadata shard");
    // Bound the read itself even if a file is replaced/grows after lstat.
    const handle = await open(path, "r");
    let bytes: Buffer;
    try {
      const buffer = Buffer.alloc(TILE_METADATA_MAX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      bytes = buffer.subarray(0, length);
    } finally { await handle.close(); }
    if (bytes.length !== shard.bytes || bytes.length > TILE_METADATA_MAX_BYTES || createHash("sha256").update(bytes).digest("hex") !== shard.sha256) throw Error("v4: corrupted metadata shard digest/size");
    const tiles = z.array(tileDeclarationSchema).min(1).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (tiles.length !== shard.tileCount || tiles[0].tileId !== shard.firstTileId || tiles.at(-1)!.tileId !== shard.lastTileId || tiles.reduce((n,t) => n + t.parts.length, 0) !== shard.partCount) throw Error("v4: wrong metadata shard tile/part counts");
    for (const tile of tiles) {
      validateTile(tile);
      if (tile.tileId <= previous) throw Error("v4: duplicate or unordered tile metadata");
      previous = tile.tileId; tileCount++; partCount += tile.parts.length;
      yield tile;
    }
  }
  if (tileCount !== metadata.tileCount || partCount !== metadata.partCount) throw Error("v4: incomplete metadata shard set");
}
/** Adaptive writer: legacy inline for a bounded small corpus, shards once the fixed 1 MiB budget is exceeded. */
export class TileMetadataWriter {
  private pending: V4Tile[] = [];
  private bytes = 3; // JSON array plus newline.
  private segmented = false;
  private last = "";
  private descriptorBytes = 0;
  private metadata: V4TileDeclarations = { version: "promotion-tile-declarations.v1", tileCount: 0, partCount: 0, shards: [] };
  private directory: string;
  constructor(directory: string, forceSegmented = false) { this.directory = directory; this.segmented = forceSegmented; }
  add(tile: V4Tile): void {
    validateTile(tile);
    if (tile.tileId <= this.last) throw Error("v4: unordered exported tile declarations");
    this.last = tile.tileId;
    const size = Buffer.byteLength(canonicalJson(tile)) + (this.pending.length ? 1 : 0);
    if (size + 3 > TILE_METADATA_MAX_BYTES) throw Error("v4: one tile declaration exceeds metadata shard budget");
    if (this.bytes + size > TILE_METADATA_MAX_BYTES) { this.segmented = true; this.flush(); }
    this.pending.push(tile); this.bytes += Buffer.byteLength(canonicalJson(tile)) + (this.pending.length > 1 ? 1 : 0);
    this.metadata.tileCount++; this.metadata.partCount += tile.parts.length;
  }
  private flush(): void {
    if (!this.pending.length) return;
    const data = Buffer.from(canonicalJson(this.pending) + "\n");
    if (data.length > TILE_METADATA_MAX_BYTES) throw Error("v4: metadata shard capacity exceeded");
    const sha256 = createHash("sha256").update(data).digest("hex"), file = `tile-metadata-${sha256}.json`;
    writeFileSync(join(this.directory, file), data, { flag: "wx" });
    const descriptor = { ordinal: this.metadata.shards.length + 1, file, sha256, bytes: data.length,
      tileCount: this.pending.length, partCount: this.pending.reduce((n,t) => n+t.parts.length,0), firstTileId: this.pending[0].tileId, lastTileId: this.pending.at(-1)!.tileId };
    this.descriptorBytes += Buffer.byteLength(canonicalJson(descriptor));
    if (this.descriptorBytes > D1_CAPACITY_POLICY.maxManifestBytes / 2) throw Error("v4: metadata shard index exceeds bounded manifest budget");
    this.metadata.shards.push(descriptor);
    this.pending = []; this.bytes = 3;
  }
  finish(): Pick<PromotionV4Manifest, "tiles" | "tileDeclarations"> {
    if (!this.segmented) return { tiles: this.pending };
    this.flush();
    return { tiles: [], tileDeclarations: this.metadata };
  }
}
