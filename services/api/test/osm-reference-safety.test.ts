import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {importAllReviewedSources} from "./support/reviewed-fixtures.ts";
import {SqliteD1, migratedSqlite, applyPromotionBundle} from "./support/sqlite-d1.ts";
import {publishTiles} from "../src/tiles/publish.ts";
import {buildMultiSourcePromotionBundle, verifyPromotionBundle} from "../src/pipeline/promotion.ts";
import {analyzeCorpus} from "../src/quality/analyze.ts";
import {generateCrossSourceCandidates} from "../src/pipeline/cross-source.ts";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const now = "2026-10-01T00:00:00Z";
const queryRows = (db: SqliteD1, table: string) => db.raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
function trackedPublicationFiles() {
 const files = spawnSync("git", ["ls-files", "services/data-pipeline/fixtures", "services/api/src/pipeline", "docs/SOURCES.md"], {cwd: root, encoding: "utf8"});
 assert.equal(files.status, 0, files.stderr);
 return files.stdout.trim().split("\n").filter(Boolean).map(file => [file, createHash("sha256").update(readFileSync(join(root, file))).digest("hex")]);
}
function workspaceChanges() {
 return [["diff", "--raw"], ["ls-files", "--others", "--exclude-standard"]].map(args => {
  const result = spawnSync("git", args, {cwd: root, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
 });
}
test("OSM reference CLI cannot change approved corpus, fixtures, registry, tiles or promotion", async t => {
 const dir = mkdtempSync(join(tmpdir(), "osm-reference-safety-"));
 t.after(() => rmSync(dir, {recursive: true, force: true}));
 const db = new SqliteD1(); t.after(() => db.raw.close());
 await importAllReviewedSources(db, now); await publishTiles(db, {now});
 const tables = ["sources", "source_releases", "source_records", "source_observations", "spots", "spot_field_provenance", "tile_snapshots", "tile_snapshot_spots"];
 const beforeRows = tables.map(table => queryRows(db, table));
 const beforeFiles = trackedPublicationFiles();
 const beforeWorkspace = workspaceChanges();
 const beforeBundle = await buildMultiSourcePromotionBundle(db);
 const input = join(dir, "reference.json"), output = join(dir, "queue.json");
 writeFileSync(input, JSON.stringify({candidates: [{id: 938742938742, latitude: 23.456789, longitude: 123.456789,
  tags: {amenity: "smoking_area", name: "REFERENCE_ONLY_SENTINEL_938742", opening_hours: "REFERENCE_HOURS"}, targetIds: ["city-nagoya"]}]}));
 const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../data-pipeline/discovery/cli.mjs", import.meta.url)),
  "--reference-leads", "osm", "--reference-input", input, "--reference-queue", output], {cwd: root, encoding: "utf8"});
 assert.equal(result.status, 0, result.stderr);
 assert.match(result.stdout, /"eligibleCount":1,"leadGroups":1/);
 assert.doesNotMatch(readFileSync(output, "utf8"), /REFERENCE_ONLY|938742938742|23\.456789|123\.456789|opening_hours|amenity/);
 assert.deepEqual(tables.map(table => queryRows(db, table)), beforeRows);
 assert.deepEqual(trackedPublicationFiles(), beforeFiles);
 assert.deepEqual(workspaceChanges(), beforeWorkspace);
 const afterBundle = await buildMultiSourcePromotionBundle(db);
 assert.equal(afterBundle.sql, beforeBundle.sql);
 assert.doesNotMatch(afterBundle.sql, /REFERENCE_ONLY|938742938742|23\.456789|123\.456789|OpenStreetMap|ODbL/);
 assert.equal(db.raw.prepare("SELECT count(*) n FROM sources WHERE kind = 'osm'").get()?.n, 0);
 const quality = await analyzeCorpus(db, {now});
 assert.ok(quality.checks.every(check => check.status === "pass"), JSON.stringify(quality.checks));
 assert.equal(quality.checks.find(check => check.id === "osm-blocked")?.status, "pass");
 assert.equal(await verifyPromotionBundle(afterBundle.sql, afterBundle.manifest.contentSha256), afterBundle.manifest.contentSha256);
 const fresh = new SqliteD1(migratedSqlite()); t.after(() => fresh.raw.close());
 applyPromotionBundle(fresh.raw, afterBundle.sql);
 assert.equal((await buildMultiSourcePromotionBundle(fresh)).sql, afterBundle.sql);
 assert.deepEqual(await generateCrossSourceCandidates(db, {now}), []);
 const tracked = spawnSync("git", ["ls-files"], {cwd: root, encoding: "utf8"});
 assert.equal(tracked.status, 0);
 assert.doesNotMatch(tracked.stdout, /\.(?:osm(?:\.pbf|\.gz|\.bz2)?|osc(?:\.gz)?)(?:\n|$)/);
});
