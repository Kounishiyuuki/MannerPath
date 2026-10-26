// Real operator facts and actual ABR output stay candidates when the existing precision gate fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { prepareIntake } from "../scripts/source-intake.ts";
import { evaluateCandidates } from "../scripts/address-anchor-candidates.ts";
import { ADDRESS_ANCHOR_DATASET_RELEASE, addressAnchorDatasetRelease } from "../src/pipeline/address-anchor.ts";
import { ensureReviewedSource, REVIEWED_SOURCES } from "../src/pipeline/registry.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const DIR = new URL("../../data-pipeline/research/official-source-intake/kanazawa-south/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, DIR));
const json = (file: string) => JSON.parse(read(file).toString());
const RELEASE = "abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d";
const inputs = json("manifest.json").sources as { sourceId: string; factsFile: string; receiptFile: string; expectedRows: number; factsSha256: string }[];

test("actual south ABR release has a pinned 15-zip manifest but all six results fail the unchanged precision gate", () => {
  assert.deepEqual(addressAnchorDatasetRelease(RELEASE), { releaseId: RELEASE, fileCount: 15, lgCodes: ["172014", "172120"] });
  assert.equal(createHash("sha256").update(read("abr-manifest.txt")).digest("hex"), RELEASE.split(":sha256:")[1]);
  assert.equal(read("abr-manifest.txt").toString().trim().split("\n").length, 15);
  assert.equal(ADDRESS_ANCHOR_DATASET_RELEASE, "abr-tokyo-6wards-2026-10-18:sha256:30b45f8ae8ee7ffa159d535d7dd420e06563d1c1bfb8f41704668f84c01e6ac2");
  const candidates = json("address-candidates.json");
  const evaluated = evaluateCandidates(candidates, json("abrg-output.json"), RELEASE);
  assert.equal(evaluated.length, 6);
  for (const result of evaluated) {
    assert.equal(result.status, "reviewPending");
    assert.ok(result.status === "reviewPending" && result.reasons.includes("precisionTooLow"));
    assert.equal("latitude" in result, false, "parcel/town coordinates do not escape as facility anchors");
  }
  assert.deepEqual(json("anchor-review.json").results, evaluated);
  // Explicit residential target is a separate genuine run, not a fabricated level upgrade.
  for (const result of evaluateCandidates(candidates, json("abrg-residential-output.json"), RELEASE)) {
    assert.equal(result.status, "reviewPending");
  }
});

test("six operator candidate rows enter source:intake without importing rights, hours or geocoder coordinates", () => {
  assert.equal(inputs.length, 6);
  const before = structuredClone(REVIEWED_SOURCES);
  const previous = new Set(json("../kanazawa/manifest.json").sources.map((s: { sourceId: string }) => s.sourceId));
  let total = 0;
  for (const input of inputs) {
    assert.equal(previous.has(input.sourceId), false);
    const bytes = read(input.factsFile);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), input.factsSha256);
    const result = prepareIntake({ metadata: json(input.receiptFile), bytes, format: "json" });
    assert.equal(result.inspection.rawRowCount, 1);
    total += result.inspection.rawRowCount!;
    assert.equal(result.publicationStatus, "blocked");
    assert.equal(result.productionApproval, false);
    assert.equal(result.humanReviewRequired, true);
    assert.equal(result.onboarding.rights.status, "RIGHTS_REVIEW_REQUIRED");
    assert.equal(result.onboarding.coordinates.kind, "unknown");
    assert.equal(result.adapterPreview, null);
    assert.deepEqual(json(input.factsFile)[0].openingHours, { status: "none", raw: null, parsed: null });
    const fact = json(input.factsFile)[0];
    assert.equal(fact.supportsPaper, "unknown");
    assert.equal(fact.supportsHeated, "unknown");
    assert.equal(fact.accessType, "unknown");
    assert.equal(fact.locationPrecision, "unknown");
    assert.equal(fact.locationAnchorCandidate, null);
    assert.equal(fact.geocodeEvidence.usableAsAnchor, false);
    assert.equal(fact.sourceUrl.includes("p-world"), false);
    assert.deepEqual(json(input.factsFile.replace("-facts", "-intake")), result);
  }
  assert.equal(total, 6);
  assert.deepEqual(REVIEWED_SOURCES, before);
});

test("unapproved south sources cannot register and existing canonical IDs and complete tile state stay unchanged", async () => {
  const db = new SqliteD1();
  try {
    const now = "2026-10-26T00:00:00Z";
    await importTaito(db, { newSpotId: sequentialSpotIds("S") });
    await publishTiles(db, { now });
    const snapshot = () => ({
      spots: db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all(),
      tiles: db.raw.prepare("SELECT * FROM tile_snapshots ORDER BY tile_id").all(),
      parts: db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY tile_id, part_index").all(),
      membership: db.raw.prepare("SELECT * FROM tile_snapshot_spots ORDER BY tile_id, spot_id").all(),
    });
    const before = snapshot();
    assert.ok(before.spots.length > 0);
    for (const input of inputs) await assert.rejects(ensureReviewedSource(db, input.sourceId, now), /not a reviewed source/);
    await publishTiles(db, { now });
    assert.deepEqual(snapshot(), before);
  } finally { db.raw.close(); }
});

test("publication plan covers the original 12 without counting subquestion resolution as publishable places", () => {
  const survey = json("survey.json");
  const facilities = survey.facilities as { id: string; decision: string }[];
  const count = (decision: string) => facilities.filter(f => f.decision === decision).length;
  assert.equal(facilities.length, 28);
  assert.equal(new Set(facilities.map(f => f.id)).size, 28);
  assert.equal(count("operatorEquipmentConfirmed"), 9);
  assert.equal(count("restrictedEquipmentListing"), 3);
  assert.equal(count("unconfirmed"), 12);
  assert.equal(count("excludedNoSmoking"), 4);
  const observed = facilities.filter(f => ["operatorEquipmentConfirmed", "restrictedEquipmentListing"].includes(f.decision));
  const plan = json("publication-plan.json");
  assert.equal(plan.investigated, 28);
  assert.equal(plan.equipmentSeenInOriginalSurvey, 12);
  assert.equal(plan.existingIntakeRows, 6);
  assert.equal(plan.newIntakeRows, 0);
  assert.equal(plan.newPublishable, 0);
  assert.equal(plan.canonicalAdded, 0);
  assert.equal(plan.publishedAdded, 0);
  assert.equal(plan.inquirySent, false);
  assert.equal(plan.promotionPerformed, false);
  assert.deepEqual(plan.facilities.map((f: { id: string }) => f.id).sort(), observed.map(f => f.id).sort());
  assert.deepEqual([...plan.priority].sort(), observed.map(f => f.id).sort());
  const intakeIds = inputs.map(input => input.sourceId).sort();
  assert.deepEqual(plan.facilities.flatMap((f: { intakeSourceId: string | null }) => f.intakeSourceId ? [f.intakeSourceId] : []).sort(), intakeIds);
  for (const facility of plan.facilities) {
    assert.equal(facility.publicationStatus, "blocked");
    assert.equal(facility.formalAdapterReady, false);
    assert.equal(facility.rightsReview.status, "sourceReviewPending");
    assert.ok(facility.blockingReasons.includes("eligibleFacilityAnchorMissing"));
    assert.ok(facility.resolutionSteps.length > 0);
    assert.equal(facility.firstPartyUrls.some((url: string) => /p-world|clubjt|openstreetmap/i.test(url)), false);
  }
  for (const id of ["sanmarco", "omega", "keiz"]) {
    const lead = plan.facilities.find((f: { id: string }) => f.id === id);
    assert.equal(lead.independentEquipmentEvidenceStatus, "notObtained");
    assert.equal(lead.intakeSourceId, null, "host identity must not promote restricted equipment into intake");
  }
  assert.equal(plan.facilities.find((f: { id: string }) => f.id === "kaikatsu").independentEquipmentEvidenceStatus,
               "chainFAQWithCurrentStore");
});
