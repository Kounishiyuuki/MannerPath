import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport } from "../../data-pipeline/discovery/report.mjs";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { evaluateCandidate, discoveryCandidates, inspectReviewedSources, compareDrift, scaffoldSource, buildQueue, run, type Candidate } from "../scripts/source-onboarding.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const resourceUrl = "https://example.test/official-smoking.csv";
function complete(): Candidate {
  return {
    sourceId: "example-city", resource: {
      rawUrl: resourceUrl, publisher: "Example City", licenseMetadata: "Reviewed license", attributionMetadata: "Example City",
      coordinateAvailability: "all", coordinateColumns: ["latitude", "longitude"], matchingRowCount: 1,
    }, review: {
      reviewedBy: "human", reviewedOn: "2026-10-07", evidenceReference: "Human review packet",
      officialPublisher: true, smokingExistence: true, commercialReuse: true, coordinateAuthorityReviewed: true,
      coordinateKind: "publisherPoint", licenseName: "Reviewed license", licenseUrl: "https://example.test/license",
      approvalGate: { exactDataset: resourceUrl, exactApplicableLicense: true, redistributionAllowed: true,
        derivationAllowed: true, publisherCoordinates: true, currentOperationEvidence: true },
    },
  };
}
function temporary(fn: (directory: string) => void) {
  const directory = mkdtempSync(resolve(tmpdir(), "onboarding-test-"));
  try { fn(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("unknown rights or coordinate authority independently block implementation readiness", () => {
  const rights = complete(); delete rights.review!.commercialReuse;
  assert.ok(evaluateCandidate(rights).blockers.includes("rightsReviewRequired"));
  const coordinates = complete(); coordinates.resource.coordinateAvailability = "unknown";
  const result = evaluateCandidate(coordinates);
  assert.equal(result.state, "BLOCKED");
  assert.ok(result.blockers.includes("coordinateAuthorityReviewRequired"));
  assert.equal(result.rights.status, "RIGHTS_REVIEWED");
});

test("ordinary webpages and external references cannot imply open data or publisher coordinates", () => {
  const ordinary = evaluateCandidate({ sourceId: "ordinary-city", resource: { rawUrl: "https://example.test/page", publisher: "Municipality" } });
  assert.equal(ordinary.rights.licenseName, null);
  assert.equal(ordinary.rights.licenseUrl, null);
  assert.equal(ordinary.rights.status, "RIGHTS_REVIEW_REQUIRED");
  assert.equal(ordinary.coordinates.kind, "unknown");
  const external = complete(); external.resource.externalReferenceOnly = true;
  assert.equal(evaluateCandidate(external).state, "BLOCKED");
  assert.ok(evaluateCandidate(external).blockers.includes("externalReferenceOnly"));
  for (const kind of ["areaApproximate", "reviewedDerived"] as const) {
    const c = complete(); c.review!.coordinateKind = kind;
    assert.equal(evaluateCandidate(c).state, "BLOCKED");
  }
});

test("complete human metadata is only adapter readiness, never approval or a registration", () => {
  const before = structuredClone(SOURCE_ADAPTERS.map(a => a.registry));
  const result = evaluateCandidate(complete());
  assert.equal(result.state, "ADAPTER_REQUIRED");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.adapter, false);
  assert.equal(result.fixture, false);
  assert.equal(result.registryEntry, false);
  assert.equal(result.publicationStatus, "blocked");
  assert.equal(result.productionApproval, false);
  assert.equal(result.approvalAutomated, false);
  assert.equal(result.quality, "notEvaluated");
  assert.equal(result.promotion, "notEvaluated");
  assert.deepEqual(SOURCE_ADAPTERS.map(a => a.registry), before);
});

test("review fields are strict booleans; unknown, spoofed approval and unscoped reviews fail closed", () => {
  for (const value of ["true", 1, "unknown", null]) {
    const c = complete(); (c.review!.approvalGate as Record<string, unknown>).publisherCoordinates = value;
    assert.throws(() => evaluateCandidate(c));
  }
  assert.throws(() => evaluateCandidate({ ...complete(), publicationStatus: "approved" } as unknown as Candidate));
  const mismatch = complete(); mismatch.review!.approvalGate!.exactDataset = "https://example.test/other.csv";
  assert.equal(evaluateCandidate(mismatch).state, "BLOCKED");
  const unknown = evaluateCandidate({ sourceId: "unknown-city", resource: {} });
  assert.equal(unknown.state, "BLOCKED");
  assert.equal(unknown.productionApproval, false);
});

test("all six reviewed sources have actual fixture, test, registry and discovery evidence", () => {
  const results = inspectReviewedSources();
  assert.equal(results.length, 6);
  for (const result of results) {
    assert.equal(result.state, "LOCAL_PIPELINE_READY", result.sourceId + JSON.stringify(result.blockers));
    assert.deepEqual(result.blockers, []);
    assert.equal(result.fixture, true);
    assert.equal(result.tests, true);
    assert.equal(result.registryEntry, true);
    assert.equal(result.productionApproval, false);
    assert.equal(result.latestLiveRelease, "unknown");
    assert.ok(result.pinnedRelease!.observedRows! > 0);
    assert.ok(result.coordinates.columns.length > 0);
  }
});

test("missing local fixture is diagnosed without altering an already reviewed source", () => temporary(directory => {
  mkdirSync(resolve(directory, "docs"));
  mkdirSync(resolve(directory, "services/data-pipeline/discovery"), { recursive: true });
  cpSync(resolve(root, "docs/SOURCES.md"), resolve(directory, "docs/SOURCES.md"));
  cpSync(resolve(root, "services/data-pipeline/discovery/manifest.json"), resolve(directory, "services/data-pipeline/discovery/manifest.json"));
  for (const result of inspectReviewedSources(directory)) {
    assert.equal(result.state, "BLOCKED");
    assert.ok(result.blockers.includes("fixtureMissing"));
    assert.equal(result.publicationStatus, "approved");
    assert.equal(result.productionApproval, false);
  }
}));

test("supplied drift detects URL, schema, license, attribution, coordinate columns and disappearance", () => {
  const baseline = inspectReviewedSources()[0].baseline;
  const changes = compareDrift(baseline, {
    sourceId: "taito-public-smoking-areas", rawUrl: "https://example.test/changed", header: ["different"],
    licenseName: "different", licenseUrl: "https://example.test/license", attributionMetadata: "different",
    coordinateColumns: ["newLatitude"], resourceAvailable: false,
  });
  assert.equal(changes.status, "detected");
  assert.deepEqual(new Set(changes.changes), new Set(["rawUrl", "header", "licenseName", "licenseUrl", "attributionMetadata", "coordinateColumns", "resourceDisappearance"]));
  const unobserved = compareDrift(baseline, { sourceId: "taito-public-smoking-areas" });
  assert.equal(unobserved.status, "suppliedFieldsUnchanged");
  assert.ok(unobserved.unobservedFields.includes("licenseUrl"));
  assert.throws(() => compareDrift(baseline, { sourceId: "taito-public-smoking-areas", resourceAvailable: "true" }));
});

test("10, 50 and 100 source queues are deterministic, review priority never approves", () => {
  for (const size of [10, 50, 100]) {
    const packets = Array.from({ length: size }, (_, index) => evaluateCandidate({ sourceId: `city-${String(index).padStart(3, "0")}`, resource: {} }));
    const queue = buildQueue(packets);
    assert.deepEqual(buildQueue([...packets].reverse()), queue);
    assert.equal(queue.needsRightsReview.length, size);
    assert.equal(queue.needsCoordinateReview.length, size);
    assert.equal(queue.adapterMissing.length, size);
    assert.deepEqual(queue.readyForLocalImplementationReview, []);
    assert.ok(packets.every(packet => !packet.productionApproval && packet.publicationStatus === "blocked"));
  }
});

test("scaffold is inert, unregistered, rejects path traversal and never overwrites", () => temporary(directory => {
  const before = SOURCE_ADAPTERS.map(a => a.registry.sourceId);
  const destination = scaffoldSource("new-city", directory);
  const metadata = JSON.parse(readFileSync(resolve(destination, "onboarding.json"), "utf8"));
  const packet = evaluateCandidate(metadata.sources[0]);
  assert.equal(packet.state, "BLOCKED");
  assert.equal(packet.publicationStatus, "blocked");
  assert.equal(packet.coordinates.kind, "unknown");
  assert.equal(packet.rights.status, "RIGHTS_REVIEW_REQUIRED");
  assert.match(readFileSync(resolve(destination, "adapter.ts"), "utf8"), /publicationStatus: "blocked"/);
  assert.throws(() => scaffoldSource("new-city", directory));
  assert.throws(() => scaffoldSource("../escape", directory));
  assert.throws(() => scaffoldSource(before[0], directory));
  assert.deepEqual(SOURCE_ADAPTERS.map(a => a.registry.sourceId), before);
}));

test("CLI emits review artifacts exclusively; existing output and duplicate source metadata are rejected", () => temporary(directory => {
  const output = resolve(directory, "packet.json");
  run(["--out", output]);
  const contents = readFileSync(output, "utf8");
  assert.equal(JSON.parse(contents).productionApproval, false);
  assert.match(readFileSync(output + ".md", "utf8"), /not production approval/);
  assert.throws(() => run(["--out", output]), /Output exists/);
  assert.equal(readFileSync(output, "utf8"), contents);
  const metadata = resolve(directory, "input.json");
  writeFileSync(metadata, JSON.stringify({ version: 1, sources: [complete(), complete()] }));
  assert.throws(() => run(["--metadata", metadata]), /Duplicate/);
  assert.throws(() => run(["--metadata"]), /Missing value/);
}));


test("discovery evidence and prior triage signals never import human review or canonical source approval", () => {
  const input = { resources: [{ rawUrl: resourceUrl, publisher: "City", matchingRowCount: 2,
    coordinateAvailability: "all", coordinateColumns: ["latitude", "longitude"],
    licenseMetadata: "CC BY", attributionMetadata: "City", publicationStatus: "approved",
    review: complete().review }], manualReviewQueue: [{ candidate: resourceUrl, classification: "EXTERNAL_REFERENCE_ONLY" }] };
  const candidates = discoveryCandidates(input);
  assert.deepEqual(discoveryCandidates(input), candidates);
  assert.match(candidates[0].sourceId, /^discovery-[a-f0-9]{16}$/);
  const result = evaluateCandidate(candidates[0]);
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.rights.status, "RIGHTS_REVIEW_REQUIRED");
  assert.equal(result.coordinates.status, "COORDINATE_AUTHORITY_REQUIRED");
  assert.equal(result.productionApproval, false);
  assert.ok(result.blockers.includes("externalReferenceOnly"));
});

test("contradictory absence of smoking rows blocks even a complete review signal", () => {
  const candidate = complete(); candidate.resource.matchingRowCount = 0;
  assert.equal(evaluateCandidate(candidate).state, "BLOCKED");
});

test("external reference coordinates are not labeled publisher-authoritative", () => {
  const candidate = complete(); candidate.resource.externalReferenceOnly = true;
  const result = evaluateCandidate(candidate);
  assert.equal(result.state, "BLOCKED");
  assert.notEqual(result.coordinates.kind, "publisherPoint");
  assert.equal(result.coordinates.status, "COORDINATE_AUTHORITY_REQUIRED");
});

test("CLI observed license drift and disappearance block advisory readiness without changing registry approval", () => temporary(directory => {
  const before = SOURCE_ADAPTERS.map(adapter => ({ ...adapter.registry }));
  const sourceId = inspectReviewedSources()[0].sourceId;
  const observation = resolve(directory, "observation.json");
  const output = resolve(directory, "drift.json");
  writeFileSync(observation, JSON.stringify([{ sourceId, licenseName: "changed license", resourceAvailable: false }]));
  run([sourceId, "--observation", observation, "--out", output]);
  const report = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(report.queue.driftDetected, [sourceId]);
  assert.deepEqual(report.queue.blocked, [sourceId]);
  assert.equal(report.sources[0].state, "BLOCKED");
  assert.equal(report.sources[0].publicationStatus, "approved");
  assert.equal(report.sources[0].productionApproval, false);
  assert.deepEqual(new Set(report.sources[0].drift.changes), new Set(["licenseName", "resourceDisappearance"]));
  assert.deepEqual(SOURCE_ADAPTERS.map(adapter => adapter.registry), before);
}));


test("actual discovery report target blockers and truncation survive onboarding import", () => {
  const manifest = { prefectures: ["東京都"], targets: [{ id: "example-target", name: "Example City", prefecture: "東京都", kind: "municipality", roles: [] }] };
  const state = { targets: { "example-target": { status: "candidate", resourceUrls: [resourceUrl], blockerCodes: ["licenseUnknown"], truncated: true } },
    resources: { [resourceUrl]: { status: "candidate", matchingRowCount: 1, coordinateAvailability: "all", coordinateColumns: ["latitude", "longitude"],
      publisher: "City", licenseMetadata: "Potential license", attributionMetadata: "City", blockerCodes: [], truncated: false } } };
  const report = buildReport(manifest, state);
  assert.deepEqual(report.resources[0].blockerCodes, []);
  assert.equal(report.resources[0].truncated, false);
  const imported = discoveryCandidates(report)[0];
  assert.ok(imported.resource.blockerCodes!.includes("licenseUnknown"));
  assert.equal(imported.resource.truncated, true);
  const packet = evaluateCandidate(imported);
  assert.equal(packet.state, "BLOCKED");
  assert.ok(packet.blockers.includes("licenseUnknown"));
  assert.ok(packet.blockers.includes("truncatedDiscovery"));
  assert.equal(packet.productionApproval, false);
});
