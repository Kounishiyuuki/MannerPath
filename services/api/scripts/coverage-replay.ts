// Replay of committed source research under ADR-0012 (coverage-first multi-confidence). Local and read-only: it
// fetches nothing, approves nothing and publishes nothing. It re-reads every committed review verdict and asks
// one question per reviewed target: was it blocked because of RIGHTS (license/reuse), because of the DATA itself
// (no smoking point, no coordinate, only a host facility…), or both — and which acquisition route it belongs to.
// Usage: npm run replay:coverage [-- --json]

import { readFileSync } from "node:fs";
import { classifyReview, type ReviewInput, summarize } from "../src/quality/coverage-replay.ts";

const DIR = new URL("../../../docs/research/nationwide-discovery/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, DIR), "utf8"));

// Oldest first: a later review of the same target supersedes an earlier one.
const sources: [string, ReviewInput[]][] = [
  ["2026-09-30-reviews.json", read("2026-09-30-reviews.json")],
  ["2026-10-01-v2-reviews.json", read("2026-10-01-v2-reviews.json").reviews],
  ["2026-10-01-west-reviews.json", read("2026-10-01-west-reviews.json")],
  ["2026-10-01-east-deep-reviews.json", read("2026-10-01-east-deep-reviews.json")],
  ["2026-10-01-high-value-reviews.json", read("2026-10-01-high-value-reviews.json")],
];

// The discovery run records each target's kind (municipality, prefecture, operator, national).
const kinds = new Map<string, string>((read("2026-09-30-run.json").targets as { id: string; kind: string }[]).map((t) => [t.id, t.kind]));

const latest = new Map<string, { file: string; review: ReviewInput }>();
for (const [file, reviews] of sources) {
  for (const review of reviews) {
    latest.set(review.targetId ?? review.jurisdiction, { file, review: { ...review, kind: kinds.get(review.targetId ?? "") ?? review.kind } });
  }
}
const classified = [...latest.entries()].map(([key, { file, review }]) => ({ key, file, ...classifyReview(review) }))
  .sort((a, b) => (a.key < b.key ? -1 : 1));
const summary = summarize(classified);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ generator: "coverage-replay.v1", adr: "ADR-0012", summary, targets: classified }, null, 2));
} else {
  console.log(`reviewed targets: ${summary.reviewedTargets} (from ${sources.length} committed review files)`);
  console.log("blocked by:", summary.blockedBy);
  console.log("acquisition route:", summary.route);
  console.log("rights-only targets (technically usable once rights are granted):");
  for (const t of classified.filter((c) => c.blockedBy === "rightsOnly")) console.log(`  ${t.key}: ${t.blockers.join(", ")}`);
}
