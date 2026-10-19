// Verifies an abr-geocoder data directory against the pinned ABR dataset release before any geocode result is trusted.
// The release digest is SHA-256 of the manifest `<sha256>  <file>\n` over every downloaded zip, sorted by file name
// (what `shasum -a 256 *.zip` prints in the download directory). A missing, extra or changed file is refused.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ADDRESS_ANCHOR_DATASET_RELEASE, addressAnchorDatasetRelease } from "../src/pipeline/address-anchor.ts";

export function datasetManifest(files: readonly { name: string; bytes: Uint8Array }[]): string {
  return [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((f) => `${createHash("sha256").update(f.bytes).digest("hex")}  ${f.name}\n`).join("");
}

/** Returns the pinned release id only when `<dataDir>/download/*.zip` reproduces its digest; throws otherwise. */
export function verifyDatasetDir(dataDir: string, pinned: string = ADDRESS_ANCHOR_DATASET_RELEASE): string {
  const expected = /:sha256:([0-9a-f]{64})$/.exec(pinned)?.[1];
  if (!expected) throw new Error(`address anchors: pinned release ${pinned} carries no digest`);
  const dir = join(dataDir, "download");
  const names = readdirSync(dir).filter((n) => n.endsWith(".zip"));
  if (names.length === 0) throw new Error(`address anchors: no ABR zip files in ${dir}`);
  const manifest = datasetManifest(names.map((name) => ({ name, bytes: readFileSync(join(dir, name)) })));
  const actual = createHash("sha256").update(manifest).digest("hex");
  if (actual !== expected) {
    throw new Error(`address anchors: dataset in ${dir} (${names.length} files, sha256:${actual}) is not the pinned release ${pinned}`);
  }
  return pinned;
}

/** `--release <id>` (default: the first release) resolved against the registry, then verified; an unknown id is refused. */
export function verifyRegisteredDatasetDir(dataDir: string, releaseId: string = ADDRESS_ANCHOR_DATASET_RELEASE): string {
  const release = addressAnchorDatasetRelease(releaseId);
  const count = readdirSync(join(dataDir, "download")).filter((n) => n.endsWith(".zip")).length;
  if (count !== release.fileCount) throw new Error(`address anchors: ${dataDir} has ${count} ABR zip files, release ${releaseId} has ${release.fileCount}`);
  return verifyDatasetDir(dataDir, release.releaseId);
}
