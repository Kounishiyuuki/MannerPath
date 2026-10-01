// GET /v1/coverage/tasks (docs/API.md, ADR-0013). Gap tasks only: spot tasks follow from tile fields every client
// already holds (coverage-tasks.v1), so asking the server about them would only tell it where the client is.
// The request carries no location and no identifier; the body is the same for every caller.

import { z } from "zod";
import { COVERAGE_TASKS_VERSION } from "./tasks.ts";
import { SEED_AREAS_VERSION } from "./seed-areas.ts";

export const COVERAGE_TASKS_SCHEMA_VERSION = 1;

export const GapTaskV1 = z.object({
  kind: z.literal("coverageGap"),
  seedAreaId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().min(1).max(64),
  prefecture: z.string().regex(/^(0[1-9]|[1-3][0-9]|4[0-7])$/),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  area: z.object({
    latitude: z.number().min(20).max(46),
    longitude: z.number().min(122).max(154),
    radiusMeters: z.number().int().min(100).max(5000),
  }).strict(),
}).strict();

export const CoverageTasksBodyV1 = z.object({
  schemaVersion: z.literal(COVERAGE_TASKS_SCHEMA_VERSION),
  rules: z.literal(COVERAGE_TASKS_VERSION),
  seedAreas: z.literal(SEED_AREAS_VERSION),
  // What a task is, in one sentence, so no client ever presents a gap as a place.
  meaning: z.literal("information around this area is thin; this is not a claim that a smoking place exists"),
  tasks: z.array(GapTaskV1),
}).strict();

export type CoverageTasksBodyV1 = z.infer<typeof CoverageTasksBodyV1>;
