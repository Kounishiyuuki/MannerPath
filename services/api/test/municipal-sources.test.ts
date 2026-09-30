// Bulk onboarding regression: every reviewed municipal source, one table row each. A new source adds a
// row here; its dedicated test file keeps the source-specific semantics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { ingestRelease, type ReleaseMetadata } from "../src/pipeline/ingest.ts";
import { observeRelease } from "../src/pipeline/observe.ts";
import { KOTO_ADAPTER, KOTO_FIXTURE_RELEASE, KOTO_FIXTURE_SHA256 } from "../src/pipeline/koto-adapter.ts";
import { KYOTO_ADAPTER, KYOTO_FIXTURE_RELEASE, KYOTO_FIXTURE_SHA256 } from "../src/pipeline/kyoto-adapter.ts";
import { MINATO_ADAPTER, MINATO_FIXTURE_RELEASE, MINATO_FIXTURE_SHA256 } from "../src/pipeline/minato-adapter.ts";
import { MUSASHINO_ADAPTER, MUSASHINO_FIXTURE_RELEASE, MUSASHINO_FIXTURE_SHA256 } from "../src/pipeline/musashino-adapter.ts";
import { OSAKA_ADAPTER, OSAKA_FIXTURE_RELEASE, OSAKA_FIXTURE_SHA256 } from "../src/pipeline/osaka-adapter.ts";
import { ensureReviewedSource } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import { observeSourceRecord, type SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { TAITO_ADAPTER } from "../src/pipeline/taito-adapter.ts";
import { TAITO_FIXTURE_RELEASE, TAITO_FIXTURE_SHA256 } from "../src/pipeline/taito.ts";
import { TileBodyV1 } from "../src/tiles/dto.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { NOW, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

interface Row {
  adapter: SourceAdapter; release: ReleaseMetadata; fixture: string; sha256: string;
  rawRows: number; selected: number; spots: number; published: number; refresh: boolean;
  coordinateIndexes?: readonly [latitude: number, longitude: number];
  /** For sources whose raw row is not header-addressed (Musashino keeps each KML Placemark verbatim). */
  withCoordinate?: (row: readonly string[], latitude: string, longitude: string) => string[];
}
const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../../data-pipeline/fixtures/${path}`, import.meta.url)));
const SOURCES: readonly Row[] = [
  { adapter: TAITO_ADAPTER, release: TAITO_FIXTURE_RELEASE, fixture: "taito-public-smoking-areas/20260818_koshukitsuenjo.csv",
    sha256: TAITO_FIXTURE_SHA256, rawRows: 34, selected: 34, spots: 34, published: 32, refresh: true },
  { adapter: OSAKA_ADAPTER, release: OSAKA_FIXTURE_RELEASE, fixture: "osaka-designated-smoking-areas/opendata_1012.csv",
    sha256: OSAKA_FIXTURE_SHA256, rawRows: 524, selected: 344, spots: 344, published: 344, refresh: false, coordinateIndexes: [13, 12] },
  { adapter: KOTO_ADAPTER, release: KOTO_FIXTURE_RELEASE, fixture: "koto-station-smoking-areas/131083_237_public_smoking_area_station.csv",
    sha256: KOTO_FIXTURE_SHA256, rawRows: 3, selected: 3, spots: 3, published: 3, refresh: false, coordinateIndexes: [0, 1] },
  { adapter: MUSASHINO_ADAPTER, release: MUSASHINO_FIXTURE_RELEASE, fixture: "musashino-public-smoking-areas/doc.kml",
    sha256: MUSASHINO_FIXTURE_SHA256, rawRows: 25, selected: 3, spots: 3, published: 3, refresh: false,
    withCoordinate: (row, latitude, longitude) => row.map((v) => v.replace(/<coordinates>[^<]*<\/coordinates>/, `<coordinates>${longitude},${latitude},0.0</coordinates>`)) },
  { adapter: MINATO_ADAPTER, release: MINATO_FIXTURE_RELEASE, fixture: "minato-designated-smoking-areas/minatokushisetsujoho_fukugo.csv",
    sha256: MINATO_FIXTURE_SHA256, rawRows: 169, selected: 114, spots: 114, published: 114, refresh: false, coordinateIndexes: [28, 29] },
  { adapter: KYOTO_ADAPTER, release: KYOTO_FIXTURE_RELEASE, fixture: "kyoto-public-smoking-places/20260903_shisetsu.csv",
    sha256: KYOTO_FIXTURE_SHA256, rawRows: 1777, selected: 17, spots: 17, published: 17, refresh: false, coordinateIndexes: [5, 6] },
];
const n = (db: SqliteD1, sql: string, ...p: unknown[]) => (db.raw.prepare(sql).get(...p) as { n: number }).n;

test("the bulk table covers exactly the reviewed adapters", () => {
  assert.deepEqual(SOURCES.map((s) => s.adapter), [...SOURCE_ADAPTERS]);
});

for (const s of SOURCES) {
  const id = s.adapter.registry.sourceId;

  test(`${id}: pinned fixture, raw/selected counts and fail-closed coordinates`, () => {
    const bytes = fixture(s.fixture);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), s.sha256);
    const { header, rows } = s.adapter.parse(bytes);
    assert.equal(rows.length, s.rawRows);
    const inScope = rows.filter((r) => s.adapter.includesRecord?.(r) ?? true);
    assert.equal(inScope.length, s.selected);
    for (const r of rows) if (!inScope.includes(r)) assert.throws(() => s.adapter.observe(r));
    const location = s.adapter.observe(inScope[0]).provenance.find((p) => p.field === "location")!;
    // Syntax and global range are checked at the shared observation boundary.
    for (const column of location.columns) {
      for (const bad of ["abc", "", "NaN", "Infinity"]) {
        let invalid: string[];
        if (s.withCoordinate) invalid = s.withCoordinate(inScope[0], bad, bad);
        else {
          assert.notEqual(header.indexOf(column), -1, `${id} location column ${column} is in the header`);
          invalid = [...inScope[0]];
          invalid[header.indexOf(column)] = bad;
        }
        assert.notDeepEqual(invalid, inScope[0]);
        assert.throws(() => observeSourceRecord(s.adapter, invalid), undefined, `${id} ${column}=${bad}`);
      }
    }
    const valid = s.adapter.observe(inScope[0]);
    for (const [latitude, longitude] of [
      ["91.0", String(valid.longitude)], ["-91.0", String(valid.longitude)],
      [String(valid.latitude), "181.0"], [String(valid.latitude), "-181.0"],
      ["139.0", "35.0"],
    ]) {
      const [latIndex, lonIndex] = s.coordinateIndexes ?? [header.indexOf("緯度"), header.indexOf("経度")];
      const invalid = s.withCoordinate
        ? s.withCoordinate(inScope[0], latitude, longitude)
        : inScope[0].map((value, i) => i === latIndex ? latitude : i === lonIndex ? longitude : value);
      assert.notDeepEqual(invalid, inScope[0]);
      assert.throws(() => observeSourceRecord(s.adapter, invalid), undefined, `${id} ${latitude},${longitude}`);
    }
  });

  test(`${id}: registry gate, observations, spots, tiles and attribution`, async () => {
    const db = new SqliteD1();
    assert.equal(s.adapter.registry.publicationStatus, "approved");
    assert.equal(s.adapter.crossReleaseValidated, false);
    assert.equal(s.adapter.refreshTarget !== undefined, s.refresh);
    await ensureReviewedSource(db, id, NOW);
    const { releaseId } = await ingestRelease(db, s.adapter, fixture(s.fixture), s.release);
    const result = await resolveFirstRelease(db, s.adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds("9") });
    assert.equal(result.status, "resolved");
    assert.equal(n(db, "SELECT count(*) n FROM source_records"), s.rawRows);
    assert.equal(n(db, "SELECT count(*) n FROM source_observations"), s.selected);
    assert.equal(n(db, "SELECT count(*) n FROM spots"), s.spots);
    const report = await publishTiles(db, { now: NOW });
    assert.equal(report.published.reduce((sum, t) => sum + t.spotCount, 0), s.published);
    for (const t of db.raw.prepare("SELECT body_json FROM tile_snapshots").all() as { body_json: string }[]) {
      const body = TileBodyV1.parse(JSON.parse(t.body_json));
      assert.deepEqual(body.sources.map((x) => [x.id, x.attributionText]), [[id, s.adapter.registry.attributionText]]);
    }
    db.raw.prepare("UPDATE sources SET publication_status = 'blocked' WHERE source_id = ?").run(id);
    const blocked = await publishTiles(db, { now: NOW });
    assert.equal(blocked.published.reduce((sum, t) => sum + t.spotCount, 0), 0);
  });
}

test("Taito out-of-range coordinates refuse the entire observation generation before writing", async () => {
  const db = new SqliteD1();
  await ensureReviewedSource(db, TAITO_ADAPTER.registry.sourceId, NOW);
  const bytes = fixture(SOURCES[0].fixture);
  const parsed = TAITO_ADAPTER.parse(bytes);
  const latitude = parsed.rows[0][parsed.header.indexOf("緯度")];
  const text = new TextDecoder().decode(bytes);
  const invalid = new TextEncoder().encode(text.replace(latitude, "999.0"));
  const { releaseId } = await ingestRelease(db, TAITO_ADAPTER, invalid, SOURCES[0].release);
  await assert.rejects(observeRelease(db, TAITO_ADAPTER, releaseId), /out-of-range coordinates/);
  assert.equal(n(db, "SELECT count(*) n FROM source_observations"), 0);
});
