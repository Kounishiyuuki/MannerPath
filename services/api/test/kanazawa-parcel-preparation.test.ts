// Candidate-only parcel evidence must not become approved sources, facility anchors or public spots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluateCandidates } from "../scripts/address-anchor-candidates.ts";
import { prepareIntake } from "../scripts/source-intake.ts";
import { ADDRESS_ANCHOR_GATE_VERSION, PARCEL_TERMS_REVIEW, addressAnchorDatasetRelease } from "../src/pipeline/address-anchor.ts";
import { parseCsv } from "../src/pipeline/csv.ts";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { ensureReviewedSource, REVIEWED_SOURCES } from "../src/pipeline/registry.ts";
import { haversineMeters } from "../src/geo/distance.ts";
import { readPublishedTiles } from "../src/tiles/parts.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { importProductionBaselineSources, PRODUCTION_BASELINE_SOURCE_IDS, REVIEWED_FIXTURES, reviewedFixtureBytes } from "./support/reviewed-fixtures.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const DIR = new URL("../../data-pipeline/research/official-source-intake/kanazawa-parcel-2026-11-08/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, DIR));
const json = (file: string) => JSON.parse(read(file).toString());
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const SOURCE_IDS = ["kurashiki-okyozuka-smoking-place", "manten-hakusan-smoking-place", "kanazawa-kokusai-hotel-smoking-place"];
const HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at",
  "candidate_latitude", "candidate_longitude", "candidate_basis", "candidate_reference"];

test("three actual parcel runs remain unapproved under the current default v3 terms gate", () => {
  const review = json("anchor-evaluation.json");
  assert.equal(ADDRESS_ANCHOR_GATE_VERSION, "address-anchor-gate.v3");
  assert.equal(PARCEL_TERMS_REVIEW, null, "research preparation must not stand in for the owner's parcel-terms approval");
  assert.deepEqual(addressAnchorDatasetRelease(review.datasetRelease).lgCodes, ["172014", "172120"]);
  const candidates = json("address-candidates.json");
  const raw = json("abrg-output.json");
  assert.deepEqual(candidates.map((candidate: { id: string }) => candidate.id), ["kurashiki", "manten", "kokusai"]);
  assert.equal(raw.length, 3);
  for (let i = 0; i < raw.length; i++) {
    assert.equal(raw[i].query.input, candidates[i].officialAddress);
    assert.equal(raw[i].result.coordinate_level, "parcel");
    assert.equal(raw[i].result.match_level, "parcel");
    assert.deepEqual(raw[i].result.others, []);
    assert.ok(Number.isFinite(raw[i].result.lat) && Number.isFinite(raw[i].result.lon));
  }
  // No parcelTerms option, fabricated approval or unmerged adapter factory is passed into this evaluation.
  const results = evaluateCandidates(candidates, raw, review.datasetRelease);
  assert.deepEqual(results, review.results);
  assert.equal(review.anchors, 0);
  assert.deepEqual(review.pendingReasons, { parcelTermsUnreviewed: 3 });
  for (const result of results) {
    assert.equal(result.status, "reviewPending");
    assert.ok(result.status === "reviewPending" && result.reasons.includes("parcelTermsUnreviewed"));
    assert.equal("latitude" in result, false);
    assert.equal("longitude" in result, false);
  }
  for (const id of SOURCE_IDS) {
    assert.equal(SOURCE_ADAPTERS.some(adapter => adapter.registry.sourceId === id), false);
    assert.equal(REVIEWED_SOURCES.some(source => source.sourceId === id), false);
  }
});

test("retrieved original terms are evidence with verified canonical identity, never an owner's approval", () => {
  const evidence = json("terms-evidence.json");
  assert.equal(evidence.originalTextVerified, true);
  assert.equal(evidence.document.title, "登記所備付地図データ利用規約");
  assert.equal(evidence.document.url, "https://www.tellusxdp.com/docs/api-service/aigid-moj/tos.pdf");
  assert.equal(evidence.document.status, 200);
  assert.equal(evidence.document.sha256, "275914c735b19cc7a274a13aac22e0c08378269d9d80f26f6b285aca32367b99");
  assert.equal(evidence.document.dateStated, "2023-01-23");
  assert.equal(evidence.document.maintainerApproval, false);
  assert.equal(evidence.formalApproval, false);
  assert.equal(evidence.parcelTermsReview, null);
  assert.equal(evidence.canonicalCurrentVersionEquivalence, "confirmedAtFollowup");
  assert.match(evidence.document.canonicalCurrentVersionEquivalence, /confirmed at/);
  assert.equal(PARCEL_TERMS_REVIEW, null);
  assert.deepEqual(evidence.applicableDatasets, ["地番マスター", "地番マスター位置参照"]);
  assert.ok(evidence.remainingDecisions.length > 0);
  assert.match(evidence.creditDraft, /MannerPath.*加工/);
});

test("three publisher-separated fact sheets preserve access qualifiers and candidate-only coordinates", () => {
  const manifest = json("manifest.json");
  assert.equal(manifest.publicationStatus, "blocked");
  assert.equal(manifest.approvalAutomated, false);
  assert.equal(manifest.productionApproval, false);
  assert.equal(manifest.parcelTermsReviewWritten, false);
  assert.deepEqual(manifest.candidateHeader, HEADER);
  assert.deepEqual(manifest.candidates.map((candidate: { sourceId: string }) => candidate.sourceId), SOURCE_IDS);
  assert.equal(new Set(manifest.candidates.map((candidate: { id: string }) => candidate.id)).size, 3);
  assert.deepEqual(manifest.readinessMetrics, {
    normalizedFactSheets: 3, fullyAddressMatched: 3, contextCorroborated: 2, weakerContext: 1, productionReady: 0,
  });
  for (const [file, digest] of Object.entries(manifest.artifactDigests)) assert.equal(hash(read(file)), digest, file);
  const release = json("anchor-evaluation.json").datasetRelease;
  assert.equal(hash(read("abr-manifest.sha256")), release.split(":sha256:")[1]);
  assert.equal(read("abr-manifest.sha256").toString().trim().split("\n").length, 15);
  assert.equal(manifest.futureIntegration.mustNotInstantiateCurrentFactory, true);
  assert.deepEqual(manifest.futureIntegration.columnMapping, {
    candidate_latitude: "anchor_latitude", candidate_longitude: "anchor_longitude",
    candidate_basis: "anchor_basis", candidate_reference: "anchor_reference",
  });
  const addresses = json("address-candidates.json");
  const raw = json("abrg-output.json");
  for (const [index, candidate] of manifest.candidates.entries()) {
    const bytes = read(candidate.files.facts);
    assert.equal(hash(bytes), candidate.csvSha256);
    const parsed = parseCsv(bytes.toString());
    assert.deepEqual(parsed.header, HEADER);
    assert.equal(parsed.rows.length, 1);
    const row = parsed.rows[0]!;
    assert.equal(row.length, 13);
    assert.equal(row[0], candidate.id);
    assert.equal(row[3], "facility");
    assert.equal(row[5], addresses[index].officialAddress);
    assert.deepEqual([Number(row[9]), Number(row[10])], [raw[index].result.lat, raw[index].result.lon]);
    assert.equal(row[11], "officialAddressGeocode");
    assert.match(row[12]!, / parcel 入力=/);
    assert.ok(row[12]!.includes(release));
    const receipt = json(candidate.files.receipt);
    const facts = json(candidate.files.factsReview);
    const rights = json(candidate.files.rightsReview);
    assert.deepEqual([receipt.sourceId, facts.sourceId, rights.sourceId, candidate.configDraft.sourceId], Array(4).fill(candidate.sourceId));
    assert.equal(receipt.resourceUrl, row[7]);
    assert.equal(candidate.configDraft.pageUrl, row[7]);
    assert.equal(facts.officialAddress, row[5]);
    assert.equal(facts.name, row[1]);
    assert.equal(facts.zones, row[4]);
    assert.equal(facts.checkedOn, row[8]);
    assert.equal(facts.supportsPaper, "unknown");
    assert.equal(facts.supportsHeated, "unknown");
    assert.equal(facts.accessType, "unknown");
    assert.equal(facts.environment, "unknown");
    assert.deepEqual(facts.openingHours, { status: "none", raw: null, parsed: null });
    assert.equal(facts.hostHoursNotSmokingHours, true);
    assert.equal(facts.notSmokingPlaceCoordinate, true);
    assert.equal(facts.currentOperation.siteVerified, false);
    assert.equal(facts.currentOperation.formalApproval, false);
    assert.equal(candidate.productionApproval, false);
    assert.equal(candidate.spatialAssessment.formalLocationApproval, false);
    assert.equal(candidate.spatialAssessment.smokingPlacePositionConfirmed, false);
    assert.equal(candidate.spatialAssessment.legalParcelExtentConfirmed, false);
    assert.equal(candidate.spatialAssessment.imageryCaptureDate, null);
    assert.equal(rights.formalApproval, false);
    assert.equal(rights.productionApproval, false);
    assert.equal(rights.notOperatorPermission, true);
    assert.equal(rights.licenseName, null);
    assert.equal(rights.licenseUrl, null);
    assert.equal(rights.reviewedBy, null);
    assert.equal(rights.reviewedOn, null);
    assert.equal(candidate.configDraft.notExecutable, true);
    assert.equal(candidate.configDraft.reviewedBy, null);
    assert.equal(candidate.configDraft.reviewedOn, null);
    assert.equal(candidate.configDraft.rightsBasisDraft.formalApproval, false);
    assert.deepEqual(candidate.configDraft.candidateValues, row);
    assert.ok(candidate.blockers.includes("parcelTermsUnreviewed"));
    assert.ok(candidate.blockers.includes("sourceSpecificFormalReviewRequired"));
    if (candidate.id === "manten") {
      assert.match(row[1]!, /一部宿泊者専用/);
      assert.match(row[4]!, /宿泊者専用/);
      assert.match(facts.knownAccessRestriction, /一部宿泊者専用/);
    }
  }
  assert.equal(manifest.candidates.find((candidate: { id: string }) => candidate.id === "kurashiki").spatialAssessment.grade, "weakerContext");
  assert.equal(manifest.candidates.filter((candidate: { spatialAssessment: { grade: string } }) => candidate.spatialAssessment.grade === "contextCorroborated").length, 2);
});

test("candidate inspection and failed registration preserve every baseline row, DTO and tile byte", async () => {
  const db = new SqliteD1();
  try {
    const now = "2026-11-08T00:00:00Z";
    assert.equal(PRODUCTION_BASELINE_SOURCE_IDS.length, 6);
    await importProductionBaselineSources(db, now);
    await publishTiles(db, { now });
    const snapshot = () => ({
      spots: db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all(),
      tiles: db.raw.prepare("SELECT * FROM tile_snapshots ORDER BY tile_id").all(),
      parts: db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY tile_id, part_index").all(),
      membership: db.raw.prepare("SELECT * FROM tile_snapshot_spots ORDER BY tile_id, spot_id").all(),
    });
    const counts = () => db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(row => ({ table: row.name, count: db.raw.prepare(`SELECT count(*) n FROM "${String(row.name).replaceAll('"', '""')}"`).get()!.n }));
    const before = snapshot();
    const beforeCounts = counts();
    const beforeChanges = db.raw.prepare("SELECT total_changes() n").get()!.n;
    const beforePublished = await readPublishedTiles(db);
    assert.equal(before.spots.length, 515);
    assert.equal(before.tiles.length, 81);
    assert.equal(beforePublished.flatMap(tile => tile.spots).length, 513);

    for (const candidate of json("manifest.json").candidates) {
      const intake = prepareIntake({ metadata: json(candidate.files.receipt), bytes: read(candidate.files.facts), format: "csv" });
      assert.deepEqual(intake, json(candidate.files.intake));
      assert.equal(intake.publicationStatus, "blocked");
      assert.equal(intake.productionApproval, false);
      assert.equal(intake.approvalAutomated, false);
      assert.equal(intake.humanReviewRequired, true);
      assert.equal(intake.adapterPreview, null);
      await assert.rejects(ensureReviewedSource(db, candidate.sourceId, now), /not a reviewed source/);
    }
    const results = evaluateCandidates(json("address-candidates.json"), json("abrg-output.json"), json("anchor-evaluation.json").datasetRelease);
    assert.equal(results.every(result => result.status === "reviewPending"), true);
    assert.deepEqual(counts(), beforeCounts);
    assert.equal(db.raw.prepare("SELECT total_changes() n").get()!.n, beforeChanges, "even an update preserving row counts would be a write");
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(await readPublishedTiles(db), beforePublished);
    const publish = await publishTiles(db, { now: "2026-11-08T00:05:00Z" });
    assert.deepEqual(publish.published, []);
    assert.equal(publish.unchanged.length, 81);
    assert.deepEqual(snapshot(), before, "candidate files never change IDs, attributes, bodies, hashes, revisions or timestamps");

    // This checks potential duplication only; a nonduplicate parcel point is still not an approved anchor.
    const existing = before.spots.map(spot => ({ latitude: Number(spot.latitude), longitude: Number(spot.longitude) }));
    for (const sourceId of ["kassen-nomura-smoking-places", "kanazawa-artvillage-smoking-places", "kkr-kanazawa-smoking-places"]) {
      const adapter = SOURCE_ADAPTERS.find(item => item.registry.sourceId === sourceId)!;
      const fixture = REVIEWED_FIXTURES[sourceId]!;
      existing.push(...adapter.reviewedAnchors!(hash(reviewedFixtureBytes(fixture.file))));
    }
    const points = json("abrg-output.json").map((record: { result: { lat: number; lon: number } }) => ({
      latitude: record.result.lat, longitude: record.result.lon,
    }));
    for (const point of points) assert.equal(existing.some(spot => haversineMeters(point, spot) <= 25), false);
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      assert.ok(haversineMeters(points[i], points[j]) > 25);
    }
  } finally { db.raw.close(); }
});

test("followup provenance and facility checks do not confer approval", () => {
  const lineage = json("data-lineage.json");
  assert.match(lineage.dataProvider, /Digital Agency ABR/);
  assert.equal(lineage.resources.length, 4);
  for (const resource of lineage.resources) {
    assert.equal(resource.currentGet.httpStatus, 200);
    assert.equal(resource.currentGet.byteIdenticalToCachedZip, true);
    assert.equal(resource.currentGet.sha256, resource.cachedZipSha256);
    assert.equal(new URL(resource.downloadUrl).hostname, "data.address-br.digital.go.jp");
  }
  assert.equal(lineage.limits.upstreamMojMapEpoch, "unconfirmed");
  assert.equal(lineage.geocoderTransformation.sourceSridForAllThree, "EPSG:6668");
  const canonical = json("canonical-terms-receipt.json");
  assert.equal(canonical.canonicalTerms.equalsPriorTellusPdfBytes, true);
  assert.equal(canonical.canonicalTerms.pdfSha256, json("terms-evidence.json").document.sha256);
  assert.equal(canonical.formalApproval, false);
  assert.equal(canonical.parcelTermsReview, null);
  const followup = json("facility-followup.json");
  assert.equal(followup.http200, 13);
  assert.equal(followup.all13BytesUnchanged, true);
  for (const facility of followup.facilities) {
    assert.equal(facility.publicationApproved, false);
    assert.equal(facility.parcelTermsApproved, false);
    assert.equal(facility.siteVisitPerformed, false);
  }
});
