import { test } from "node:test";
import assert from "node:assert/strict";
import { CoverageSpatialIndex } from "../src/coverage/spatial-index.ts";
import { haversineMeters } from "../src/geo/distance.ts";
import { gapTasks } from "../src/coverage/tasks.ts";
import { SEED_AREAS } from "../src/coverage/seed-areas.ts";
import { CAMPAIGN_PHASES, campaignProgress, seedProgress } from "../src/coverage/progress.ts";
import { publishedGapTasks } from "../src/coverage/published-gaps.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";
import { importAllReviewedSources } from "./support/reviewed-fixtures.ts";
import { publishTiles } from "../src/tiles/publish.ts";
test("indexed coverage matches exact nationwide distance checks at 10k", () => {
  const points = Array.from({length:10000}, (_,i) => ({ latitude: 25+(i*7919%20000)/1000, longitude:125+(i*1543%20000)/1000 }));
  const index = new CoverageSpatialIndex(points);
  for (const seed of SEED_AREAS) assert.deepEqual(index.within(seed,1000),points.filter((p) => haversineMeters(seed,p)<=1000));
});
test("kind-specific versioned progress and 1,000 campaign phases", () => {
  assert.equal(CAMPAIGN_PHASES.reduce((a,p)=>a+p.additionalSpots,0),1000);
  assert.equal(seedProgress("airport",{allVisible:0,official:0,communityVerified:0}),"active");
  assert.equal(seedProgress("airport",{allVisible:1,official:0,communityVerified:0}),"progressing");
  assert.equal(seedProgress("airport",{allVisible:3,official:2,communityVerified:0}),"sufficientlyCovered");
  assert.equal(seedProgress("majorStation",{allVisible:3,official:2,communityVerified:0}),"progressing");
  const p=campaignProgress([]); assert.equal(p.zeroCoverage,249); assert.equal(p.prefectures.length,47);
});
test("single SQL published coverage matches exact snapshot coverage and uses spatial index", async () => {
  const db=new SqliteD1();
  try {
    await importAllReviewedSources(db,"2026-10-01T00:00:00Z"); await publishTiles(db,{now:"2026-10-01T00:00:00Z"});
    const points=(await db.prepare("SELECT s.latitude,s.longitude FROM spots s JOIN tile_snapshot_spots t ON t.spot_id=s.spot_id").all<{latitude:number;longitude:number}>()).results;
    assert.deepEqual(await publishedGapTasks(db),gapTasks(points));
    const plan=(await db.prepare("EXPLAIN QUERY PLAN SELECT spot_id FROM spots WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?").bind(35,36,139,140).all<{detail:string}>()).results;
    assert.ok(plan.some((p)=>p.detail.includes("idx_spots_latitude_longitude")));
  } finally {db.raw.close();}
});

test("campaign progress CLI emits deterministic public JSON and Markdown", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const directory=mkdtempSync(join(tmpdir(),"campaign-progress-"));
  try {
    const input=join(directory,"spots.json"); writeFileSync(input,"[]");
    const invoke=()=>execFileSync(process.execPath,["--experimental-strip-types","--no-warnings",new URL("../scripts/campaign-progress.ts",import.meta.url).pathname,"--spots",input,"--out",directory]);
    invoke(); const json=readFileSync(join(directory,"progress.json"),"utf8"),md=readFileSync(join(directory,"progress.md"),"utf8");
    invoke(); assert.equal(readFileSync(join(directory,"progress.json"),"utf8"),json); assert.equal(readFileSync(join(directory,"progress.md"),"utf8"),md);
    const p=JSON.parse(json); assert.equal(p.zeroCoverage,249); assert.equal(p.phases[3].cumulativeTarget,1000);
    assert.doesNotMatch(json,/submitter|reportId|note|observedAt|latitude|longitude/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test("pathological boundary candidates stop at a bounded query and never infer false gaps", async () => {
  const { CoverageProbeOverflow } = await import("../src/coverage/published-gaps.ts");
  let sql="";
  const db={prepare(query:string) {sql=query;return {bind(...params:unknown[]) {
    assert.equal(params.length,2);return {async all() {return {results:Array.from({length:4097},()=>({id:"tokyo-shinjuku",latitude:35.69,longitude:139.7}))};}};
  }};}};
  await assert.rejects(publishedGapTasks(db as unknown as import("../src/db.ts").Db),CoverageProbeOverflow);
  assert.match(sql,/LIMIT 4097/);
});

test("SQL covered shortcut uses the exact shared Earth radius at the 1,000m boundary", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { EARTH_RADIUS_M } = await import("../src/geo/distance.ts");
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE spots(spot_id TEXT PRIMARY KEY,latitude REAL,longitude REAL); CREATE INDEX spatial ON spots(latitude,longitude); CREATE TABLE tile_snapshot_spots(spot_id TEXT PRIMARY KEY);");
  const seed=SEED_AREAS.find((s)=>s.id === "tokyo-shinjuku")!;
  const db={prepare(query:string) {return {bind(...params:unknown[]) {return {async all() {
    return {results:raw.prepare(query).all(...params as (string|number)[])};
  }};}};}};
  try {
    for (const distance of [999.9995,1000.0005]) {
      const point={latitude:seed.latitude+distance/EARTH_RADIUS_M*180/Math.PI,longitude:seed.longitude};
      raw.exec("DELETE FROM spots; DELETE FROM tile_snapshot_spots;");
      raw.prepare("INSERT INTO spots VALUES ('boundary',?,?)").run(point.latitude,point.longitude);
      raw.exec("INSERT INTO tile_snapshot_spots VALUES ('boundary');");
      assert.ok(Math.abs(haversineMeters(seed,point)-distance)<.000001);
      assert.deepEqual(await publishedGapTasks(db as unknown as import("../src/db.ts").Db),gapTasks([point]));
    }
  } finally {raw.close();}
});
