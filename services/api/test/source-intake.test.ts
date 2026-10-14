import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseCsv } from "../src/pipeline/csv.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { prepareIntake, receiptSchema, run } from "../scripts/source-intake.ts";

const encode = (text: string) => new TextEncoder().encode(text);
const header = "supplier_id,name,latitude,longitude,floor";
const csv = (rows = ["supplier-01,架空喫煙所,35.1,139.1,1F"]) => encode([header, ...rows].join("\n") + "\n");
const synthetic: SourceAdapter = {
  registry: { sourceId: "synthetic-intake-only", displayName: "Synthetic", kind: "operator", licenseName: null,
    licenseUrl: null, attributionText: null, publicationStatus: "blocked" },
  parserVersion: "synthetic.v1", mappingVersion: "synthetic.v1", resolverVersion: "synthetic.v1",
  parse: bytes => parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  upstreamRowRef: row => row[0] || null,
  observe: row => ({ name: row[1], latitude: Number(row[2]), longitude: Number(row[3]), supportsPaper: "unknown",
    supportsHeated: "unknown", openingHours: { status: "none", raw: null, parsed: null }, lifecycle: "active",
    provenance: [{ field: "location", columns: ["latitude", "longitude"], rule: "synthetic.coordinates.v1" }] }),
  assertResolvable() { throw new Error("Synthetic adapter is never resolvable"); },
  attenuate: () => [], crossReleaseValidated: false,
  attenuationReference: { attestationVersion: "synthetic.v1", referenceKind: "synthetic", referenceUrl: "https://supplier.invalid/evidence", checkedAt: "2026-10-15" },
};
function temporary(fn: (directory: string) => void) {
  const directory = mkdtempSync(resolve(tmpdir(), "source-intake-test-"));
  try { fn(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("receipt rejects unknown approval flags and URL schemes instead of accepting authority claims", () => {
  for (const value of [{ publicationStatus: "approved" }, { productionApproval: true }, { approvalAutomated: true }, { reviewStatus: "APPROVED" }]) {
    assert.equal(receiptSchema.safeParse({ ...metadata(), ...value }).success, false);
  }
  for (const publisherUrl of ["file:///private/data", "javascript:alert(1)", "not-a-url"]) {
    assert.equal(receiptSchema.safeParse({ ...metadata(), publisherUrl }).success, false);
  }
});

test("malformed files reject; missing JSON fields remain unknown and explicitly diagnosed", () => {
  for (const bytes of [encode(header + "\nsupplier-01,喫煙所\n"), encode(header + '\n"unterminated\n'), new Uint8Array([0xff, 0xfe, 0xff])]) {
    assert.throws(() => prepareIntake({ metadata: metadata(), bytes, format: "csv" }));
  }
  assert.throws(() => prepareIntake({ metadata: metadata(), bytes: csv(), format: "html" as "csv" }));
  assert.throws(() => prepareIntake({ metadata: metadata(), bytes: encode('{"unclosed":'), format: "json" }));
  const result = prepareIntake({ metadata: metadata(), bytes: encode(JSON.stringify([{ name: "喫煙所", latitude: 35, longitude: 139 }, { name: "喫煙所", latitude: 35 }])), format: "json" });
  assert.equal(result.inspection.rawRowCount, 2);
  assert.equal(result.inspection.missingFieldCount, 1);
  assert.ok(result.reviewHints.includes("MISSING_OR_NULL_FIELDS_REMAIN_UNKNOWN"));
  assert.equal(result.productionApproval, false);
  assert.equal(result.publicationStatus, "blocked");
});

test("pure intake neither fetches nor registers, resolves, matches or mutates its inputs", () => {
  const before = structuredClone(SOURCE_ADAPTERS.map(adapter => adapter.registry));
  const receipt = metadata(); const snapshot = structuredClone(receipt); const bytes = csv(); const original = bytes.slice();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Network must never be used"); }) as typeof fetch;
  try {
    const result = prepareIntake({ metadata: receipt, bytes, format: "csv", adapter: synthetic });
    assert.equal(result.publicationStatus, "blocked");
    assert.equal(result.productionApproval, false);
    assert.equal(result.approvalAutomated, false);
    assert.equal(result.humanReviewRequired, true);
    assert.equal(result.receipt.reviewStatus, "UNREVIEWED");
    assert.equal(result.adapterPreview!.observations[0].upstreamRowRef, "supplier-01");
    assert.equal(result.adapterPreview!.observations[0].observation.supportsPaper, "unknown");
    assert.equal(result.adapterPreview!.observations[0].observation.openingHours.status, "none");
    assert.deepEqual(receipt, snapshot); assert.deepEqual(bytes, original);
    assert.deepEqual(SOURCE_ADAPTERS.map(adapter => adapter.registry), before);
  } finally { globalThis.fetch = previousFetch; }
});

test("same coordinates on distinct floors retain separate supplier identities", () => {
  const result = prepareIntake({ metadata: metadata(), bytes: csv(["supplier-01,喫煙所1,35.1,139.1,1F", "supplier-02,喫煙所2,35.1,139.1,2F"]), format: "csv", adapter: synthetic });
  assert.deepEqual(result.adapterPreview!.observations.map(row => row.upstreamRowRef), ["supplier-01", "supplier-02"]);
  assert.equal(result.adapterPreview!.observations.length, 2);
  assert.ok(result.reviewHints.includes("SHARED_COORDINATES_REVIEW_REQUIRED"));
  assert.equal(result.productionApproval, false);
});

test("any coordinate movement under supplier identity produces review hints without canonical matching", () => {
  const result = prepareIntake({ metadata: metadata(), bytes: csv(["supplier-01,喫煙所,35.100000001,139.1,1F"]),
    previousBytes: csv(), format: "csv", adapter: synthetic });
  assert.equal(result.diff!.status, "changed");
  assert.ok(result.diff!.rowHints.some(row => row.upstreamRowRef === "supplier-01" && row.relocationReviewRequired));
  assert.equal(result.productionApproval, false);
  assert.equal(result.diff!.missingRowsMeaning, "unknown");
});

test("disappeared previous rows never imply closure even for a supplied complete adapter", () => {
  const result = prepareIntake({ metadata: metadata(), bytes: csv(), previousBytes: csv(["supplier-01,架空喫煙所,35.1,139.1,1F", "supplier-02,喫煙所2,35.2,139.2,2F"]),
    format: "csv", adapter: { ...synthetic, completeness: "complete" } });
  assert.equal(result.diff!.missingRowsMeaning, "unknown");
  assert.deepEqual(result.adapterPreview!.observations.map(row => row.observation.lifecycle), ["active"]);
  assert.equal(result.productionApproval, false);
});

function metadata() {
  return { version: 1, sourceId: "synthetic-intake-only", publisher: "Synthetic Supplier", publisherUrl: "https://supplier.invalid/",
    resourceUrl: "https://supplier.invalid/smoking.csv", receivedOn: "2026-10-15", evidenceReference: "https://supplier.invalid/existence",
    rightsReference: "https://supplier.invalid/terms", attributionText: "Synthetic supplier", licenseName: "Unreviewed synthetic license",
    licenseUrl: "https://supplier.invalid/license", operationEvidenceReference: "https://supplier.invalid/current",
    coordinateMeaning: "smokingPlace", operationClaim: "active" };
}

test("provider license prose and complete receipts remain unreviewed rather than approving a source", () => {
  const result = prepareIntake({ metadata: metadata(), bytes: csv(), format: "csv" });
  assert.equal(result.productionApproval, false);
  assert.equal(result.onboarding.publicationStatus, "blocked");
  assert.equal(result.onboarding.rights.status, "RIGHTS_REVIEW_REQUIRED");
  assert.equal(result.onboarding.coordinates.kind, "unknown");
});

test("independent missing evidence and rights remain visible as review requirements", () => {
  for (const field of ["rightsReference", "evidenceReference", "operationEvidenceReference"] as const) {
    const result = prepareIntake({ metadata: { ...metadata(), [field]: null }, bytes: csv(), format: "csv" });
    assert.equal(result.productionApproval, false);
    assert.equal(result.receipt[field], null);
    assert.equal(result.onboarding.state, "BLOCKED");
  }
  const result = prepareIntake({ metadata: metadata(), bytes: encode("supplier_id,name\nsupplier-01,架空喫煙所\n"), format: "csv" });
  assert.notEqual(result.inspection.scanner!.coordinateAvailability, "all");
  assert.equal(result.productionApproval, false);
});

test("facility coordinates remain review-only anchor context and cannot masquerade as exact smoking points", () => {
  const result = prepareIntake({ metadata: { ...metadata(), coordinateMeaning: "facility" }, bytes: csv(), format: "csv" });
  assert.notEqual(result.onboarding.coordinates.kind, "publisherPoint");
  assert.equal(result.productionApproval, false);
  assert.ok(result.reviewHints.length > 0);
  assert.equal(receiptSchema.safeParse({ ...metadata(), coordinateMeaning: "facility", locationPrecision: "publisherPoint" }).success, false);
  assert.equal(receiptSchema.safeParse({ ...metadata(), coordinateMeaning: "facility", reviewedAnchor: true }).success, false);
});

test("closure and relocation claims are human-review context and never canonical lifecycle changes", () => {
  for (const operationClaim of ["closed", "relocated"] as const) {
    const result = prepareIntake({ metadata: { ...metadata(), operationClaim }, bytes: csv(), format: "csv", adapter: synthetic });
    assert.ok(result.reviewHints.includes("OPERATION_CHANGE_REVIEW_REQUIRED"));
    assert.equal(result.productionApproval, false);
    assert.equal(result.adapterPreview!.observations[0].observation.lifecycle, "active");
  }
});

test("duplicate supplier identifiers preserve rows and require manual review", () => {
  const result = prepareIntake({ metadata: metadata(), bytes: csv(["supplier-01,喫煙所1,35.1,139.1,1F", "supplier-01,喫煙所2,35.2,139.2,2F"]), format: "csv", adapter: synthetic });
  assert.equal(result.adapterPreview!.observations.length, 2);
  assert.ok(result.reviewHints.includes("DUPLICATE_UPSTREAM_REFERENCES_REVIEW_REQUIRED"));
  assert.equal(result.productionApproval, false);
});

test("bounded validation errors never echo arbitrary private row or metadata contents", () => {
  const privateValue = "private-person@example.invalid";
  for (const fn of [
    () => prepareIntake({ metadata: { ...metadata(), receivedOn: privateValue }, bytes: csv(), format: "csv" }),
    () => prepareIntake({ metadata: metadata(), bytes: encode(header + "\n" + privateValue), format: "csv" }),
    () => prepareIntake({ metadata: metadata(), bytes: csv(), format: "csv", adapter: { ...synthetic, observe() { throw new Error(privateValue.repeat(1000)); } } }),
    () => prepareIntake({ metadata: metadata(), bytes: new Uint8Array(20 * 1024 * 1024), format: "csv" }),
  ]) {
    assert.throws(fn, error => { assert.ok(error instanceof Error); assert.ok(error.message.length < 1000); assert.ok(!error.message.includes(privateValue)); return true; });
  }
});

test("CLI writes only review artifacts, refuses overwrites and symlink destinations", () => temporary(directory => {
  const metadataPath = resolve(directory, "receipt.json"); const file = resolve(directory, "received.csv"); const output = resolve(directory, "review.json");
  writeFileSync(metadataPath, JSON.stringify(metadata())); writeFileSync(file, csv());
  run(["--metadata", metadataPath, "--file", file, "--format", "csv", "--out", output]);
  const saved = readFileSync(output, "utf8");
  assert.equal(JSON.parse(saved).productionApproval, false);
  assert.throws(() => run(["--metadata", metadataPath, "--file", file, "--format", "csv", "--out", output]));
  assert.equal(readFileSync(output, "utf8"), saved);
  const protectedDirectory = resolve(directory, "protected"); mkdirSync(protectedDirectory);
  const link = resolve(directory, "link"); symlinkSync(protectedDirectory, link);
  assert.throws(() => run(["--metadata", metadataPath, "--file", file, "--format", "csv", "--out", resolve(link, "review.json")]));
  assert.deepEqual(readdirSync(protectedDirectory), []);
  assert.deepEqual(new Set(readdirSync(directory)), new Set(["receipt.json", "received.csv", "review.json", "protected", "link"]));
}));

test("facility preview requires an approximate anchor and rejects exact point observation", () => {
  const receipt = { ...metadata(), coordinateMeaning: "facility" };
  assert.throws(() => prepareIntake({ metadata: receipt, bytes: csv(), format: "csv", adapter: synthetic }));
  const anchored: SourceAdapter = { ...synthetic, observe: row => ({ ...synthetic.observe(row), locationAnchorId: "synthetic-facility-anchor" }) };
  const result = prepareIntake({ metadata: receipt, bytes: csv(), format: "csv", adapter: anchored });
  assert.equal(result.adapterPreview!.observations[0].observation.locationAnchorId, "synthetic-facility-anchor");
  assert.equal(result.receipt.coordinateMeaning, "facility");
  assert.notEqual(result.onboarding.coordinates.kind, "publisherPoint");
  assert.equal(result.productionApproval, false);
});

test("adapter identity mismatches and duplicate JSON metadata fail before producing artifacts", () => temporary(directory => {
  assert.throws(() => prepareIntake({ metadata: { ...metadata(), sourceId: "another-supplier" }, bytes: csv(), format: "csv", adapter: synthetic }));
  const metadataPath = resolve(directory, "receipt.json"); const file = resolve(directory, "received.csv"); const output = resolve(directory, "review.json");
  const valid = JSON.stringify(metadata());
  writeFileSync(metadataPath, valid.slice(0, -1) + ',"sourceId":"approved-imposter"}');
  writeFileSync(file, csv());
  assert.throws(() => run(["--metadata", metadataPath, "--file", file, "--format", "csv", "--out", output]));
  assert.deepEqual(readdirSync(directory).sort(), ["receipt.json", "received.csv"]);
}));

test("empty and whitespace CSV cells remain missing without manufacturing values", () => {
  const bytes = csv(["supplier-01,架空喫煙所,,139.1,1F", "supplier-02,架空喫煙所2,   ,139.2,2F"]);
  const before = bytes.slice();
  const result = prepareIntake({ metadata: metadata(), bytes, format: "csv" });
  assert.equal(result.inspection.rawRowCount, 2);
  assert.equal(result.inspection.missingFieldCount, 2);
  assert.ok(result.reviewHints.includes("MISSING_OR_NULL_FIELDS_REMAIN_UNKNOWN"));
  assert.ok(result.reviewHints.includes("PARTIAL_FIELDS_REVIEW_REQUIRED"));
  assert.notEqual(result.inspection.scanner!.coordinateAvailability, "all");
  assert.equal(result.adapterPreview, null);
  assert.equal(result.publicationStatus, "blocked");
  assert.equal(result.productionApproval, false);
  assert.deepEqual(bytes, before);
});

test("PDF and map bytes stay manual evidence with no inferred rows or coordinates", () => {
  for (const format of ["pdf", "map"] as const) {
    const result = prepareIntake({ metadata: metadata(), bytes: encode("synthetic opaque document"), format });
    assert.equal(result.inspection.rawRowCount, null);
    assert.deepEqual(result.inspection.header, []);
    assert.equal(result.inspection.scanner, null);
    assert.equal(result.adapterPreview, null);
    assert.ok(result.reviewHints.includes("MANUAL_EVIDENCE_REVIEW"));
    assert.equal(result.publicationStatus, "blocked");
    assert.equal(result.productionApproval, false);
    assert.throws(() => prepareIntake({ metadata: metadata(), bytes: encode("synthetic opaque document"), format, adapter: synthetic }));
  }
});

test("wide sparse JSON retains every row and diagnoses all absent keys", () => {
  const rows = Array.from({ length: 2000 }, (_, index) => ({ ["synthetic_field_" + index]: index }));
  const result = prepareIntake({ metadata: metadata(), bytes: encode(JSON.stringify(rows)), format: "json" });
  assert.equal(result.inspection.rawRowCount, 2000);
  assert.equal(result.inspection.header.length, 2000);
  assert.equal(result.inspection.missingFieldCount, 2000 * 1999);
  assert.ok(result.reviewHints.includes("PARTIAL_FIELDS_REVIEW_REQUIRED"));
  assert.equal(result.productionApproval, false);
});

test("excessively nested JSON fails with a bounded diagnostic", () => {
  const privateValue = "private-person@example.invalid";
  const deeplyNested = "[".repeat(130) + JSON.stringify(privateValue) + "]".repeat(130);
  assert.throws(() => prepareIntake({ metadata: metadata(), bytes: encode(deeplyNested), format: "json" }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /nesting|depth|limit/i);
    assert.ok(error.message.length < 1000);
    assert.ok(!error.message.includes(privateValue));
    return true;
  });
});
