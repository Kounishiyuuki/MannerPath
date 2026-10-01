// Community acquisition targets and seed-area priority (ADR-0013). Local and read-only: it reads the committed research
// replay (docs/research/nationwide-discovery/2026-10-01-coverage-replay.json) and the seed-area list, fetches nothing
// and writes nothing; it prints the collection plan. No output is smoking-place data.
// Usage: npm run coverage:targets [-- --json]

import { readFileSync } from "node:fs";
import { ALWAYS_COLLECT, ACQUISITION_TARGETS_VERSION, acquisitionTargets, seedPriority } from "../src/coverage/targets.ts";
import { SEED_AREAS_VERSION } from "../src/coverage/seed-areas.ts";

const replay = JSON.parse(readFileSync(new URL("../../../docs/research/nationwide-discovery/2026-10-01-coverage-replay.json", import.meta.url), "utf8"));
const targets = acquisitionTargets(replay.targets);
const seeds = seedPriority(targets);
const body = {
  generator: ACQUISITION_TARGETS_VERSION,
  seedAreas: SEED_AREAS_VERSION,
  input: { replay: replay.generator, reviewedTargets: replay.summary.reviewedTargets },
  meaning: "collection priority only; no entry claims that a smoking place exists",
  alwaysCollect: ALWAYS_COLLECT,
  summary: {
    communityTargets: targets.length,
    linkedToSeedArea: targets.filter((t) => t.seedAreaIds.length > 0).length,
    withoutSeedArea: targets.filter((t) => t.seedAreaIds.length === 0).map((t) => t.key),
    seedAreas: seeds.length,
    seedAreasByPriority: { 1: seeds.filter((s) => s.priority === 1).length, 2: seeds.filter((s) => s.priority === 2).length, 3: seeds.filter((s) => s.priority === 3).length },
  },
  targets,
  seedPriority: seeds,
};
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(body, null, 2));
} else {
  console.log(`community acquisition targets: ${targets.length} (linked to a seed area: ${body.summary.linkedToSeedArea})`);
  for (const t of targets) console.log(`  [${t.priority ?? "-"}] ${t.jurisdiction} (${t.key}): ask for ${t.askFor.join(", ") || "-"}; seeds ${t.seedAreaIds.join(", ") || "none"}`);
}
