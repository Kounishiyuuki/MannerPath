import { test } from "node:test";
import assert from "node:assert/strict";
import { corpusDigest, syntheticSpots, SCENARIOS, PROFILES, syntheticId } from "../scripts/scale/corpus.ts";
import { SEED_AREAS } from "../src/coverage/seed-areas.ts";

test("synthetic profiles stream exact 1k/10k cardinalities and cover nationwide seeds and every scenario", () => {
  for (const profile of ["small", "medium"] as const) {
    let spots = 0, reports = 0;
    const seeds = new Set<string>(), scenarios = new Set<string>(), prefectures = new Set<string>();
    for (const s of syntheticSpots(profile)) { spots++; reports += s.reportIds.length; seeds.add(s.seedAreaId); scenarios.add(s.scenario); prefectures.add(s.prefecture); }
    assert.equal(spots, PROFILES[profile]); assert.equal(reports, PROFILES[profile] * 5);
    assert.equal(seeds.size, SEED_AREAS.length); assert.equal(prefectures.size, 47); assert.equal(scenarios.size, SCENARIOS.length);
  }
});
test("fixed seed gives byte-identical corpus; distinct seed changes it; generated identifiers are stable and unique", () => {
  assert.equal(corpusDigest("small"), corpusDigest("small"));
  assert.notEqual(corpusDigest("small"), corpusDigest("small", 123));
  assert.match(syntheticId("sp", 999999), /^sp_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.notEqual(syntheticId("sp", 0), syntheticId("sp", 1));
});

import { scaleOptions } from "../scripts/scale/options.ts";
test("scale CLI defaults and explicit profiles reject malformed or unknown options", () => {
  assert.equal(scaleOptions([]).profile,"small");
  assert.deepEqual(scaleOptions(["--output","/tmp/test"]),{profile:"small",output:"/tmp/test"});
  assert.equal(scaleOptions(["--output","/tmp/test","--profile","medium"]).profile,"medium");
  for (const args of [["--profile"],["--profile","unknown"],["--output"],["--unknown","small"],["--profile","small","--profile","large"]]) assert.throws(()=>scaleOptions(args));
});
