// Replay of address-only official smoking candidates through the ADR-0011 derived-coordinate gate (local only).
// Reads the committed candidate list, geocodes nothing and publishes nothing. Two passes:
//   current      what the gate says today: every source is unapproved and no address has been geocoded.
//   bestCase     a SIMULATION of the most favourable outcome: the policy is approved, every source whose license is
//                already established is approved, and each address form geocodes at the precision it could at best
//                reach (street address → residential detail, parcel → parcel). It is an upper bound, not a forecast.
// Usage: npm run replay:derived-coordinates [-- --json]

import { readFileSync } from "node:fs";
import {
  type AbrLevel, type DerivedCoordinateInput, REVIEWED_GEOCODERS, evaluateDerivedCoordinate,
} from "../src/pipeline/derived-coordinate.ts";

interface Candidate {
  id: string; prefecture: string; municipality: string; majorCity: boolean;
  addressForm: "streetAddress" | "parcelAddress" | "relativeOrStation" | "nameOnly" | "imageOrPdf" | "none" | "unverified";
  license: "established" | "unknown" | "blocked"; currentOperation: "confirmed" | "partial" | "unknown";
  spotCount: number | null; existence: "officialSmokingPlace";
}

const FILE = new URL("../../data-pipeline/derived-coordinates/address-only-candidates.json", import.meta.url);
const candidates = (JSON.parse(readFileSync(FILE, "utf8")) as { candidates: Candidate[] }).candidates;
// Prefectures already served by a reviewed source in docs/SOURCES.md.
const COVERED_PREFECTURES = new Set(["東京都", "大阪府", "京都府"]);
const SIMULATED_DATASET = "0".repeat(64);
const bestLevel = (form: Candidate["addressForm"]): AbrLevel | null =>
  form === "streetAddress" ? "residential_detail" : form === "parcelAddress" ? "parcel" : null;

function input(c: Candidate, bestCase: boolean): DerivedCoordinateInput {
  const level = bestCase ? bestLevel(c.addressForm) : null;
  return {
    source: {
      sourceId: c.id,
      publicationStatus: bestCase && c.license === "established" ? "approved" : "blocked",
      existenceEvidence: c.existence,
      currentOperation: c.currentOperation === "confirmed" ? "confirmed" : "unknown",
      addressReuse: c.license === "established" ? "reviewed" : c.license === "blocked" ? "forbidden" : "unknown",
    },
    record: {
      recordId: 0, addressColumn: "(simulated)", officialAddress: "(not copied)", addressSuppliedBy: c.addressForm === "none" ? "other" : "publisher",
      inputRule: "verbatim", expectedPrefecture: c.prefecture, expectedMunicipality: c.municipality,
    },
    geocode: level === null ? null : {
      geocoderId: "abr-geocoder", geocoderVersion: "2.3.1", options: { target: "all", fuzzy: null }, datasetReleaseId: SIMULATED_DATASET,
      input: "(simulated)", output: "(simulated)", others: [], score: 1, matchLevel: level, coordinateLevel: level,
      latitude: 35, longitude: 135, srid: "EPSG:6668", lgCode: null, pref: c.prefecture, city: c.municipality, ward: null, candidateCount: 1,
    },
  };
}

const simulatedGeocoders = REVIEWED_GEOCODERS.map((g) => ({ ...g, datasetReleases: [SIMULATED_DATASET] }));
const rows = candidates.map((c) => ({
  c,
  current: evaluateDerivedCoordinate(input(c, false)),
  bestCase: evaluateDerivedCoordinate(input(c, true), simulatedGeocoders),
}));
const spots = (list: typeof rows) => ({
  stated: list.reduce((n, r) => n + (r.c.spotCount ?? 0), 0),
  withoutStatedCount: list.filter((r) => r.c.spotCount === null).length,
});
const summarize = (list: typeof rows) => ({
  candidates: list.length,
  spots: spots(list),
  prefectures: [...new Set(list.map((r) => r.c.prefecture))],
  newPrefectures: [...new Set(list.map((r) => r.c.prefecture).filter((p) => !COVERED_PREFECTURES.has(p)))],
  majorCities: list.filter((r) => r.c.majorCity).map((r) => r.c.municipality),
});
const exact = rows.filter((r) => r.c.addressForm === "streetAddress" || r.c.addressForm === "parcelAddress");
const report = {
  total: summarize(rows),
  exactAddress: summarize(exact),
  likelyGeocodable: summarize(rows.filter((r) => r.c.addressForm === "streetAddress")),
  insufficientAddress: summarize(rows.filter((r) => ["nameOnly", "none", "relativeOrStation", "imageOrPdf"].includes(r.c.addressForm))),
  addressFormUnverified: summarize(rows.filter((r) => r.c.addressForm === "unverified")),
  currentOperationBlocked: summarize(rows.filter((r) => r.c.currentOperation !== "confirmed")),
  licenseBlocked: summarize(rows.filter((r) => r.c.license === "blocked")),
  licenseUnknown: summarize(rows.filter((r) => r.c.license === "unknown")),
  exactAddressIfLicensesResolved: summarize(exact.filter((r) => r.c.currentOperation === "confirmed" && r.c.license !== "blocked")),
  gate: {
    currentPassing: rows.filter((r) => r.current.verdict !== "rejected").map((r) => r.c.id),
    bestCaseCandidate: rows.filter((r) => r.bestCase.verdict === "candidate").map((r) => r.c.id),
    bestCaseReviewRequired: rows.filter((r) => r.bestCase.verdict === "reviewRequired").map((r) => r.c.id),
    bestCaseRejections: Object.fromEntries(rows.map((r) => [r.c.id, r.bestCase.rejections])),
  },
};

if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  for (const [k, v] of Object.entries(report)) {
    if (k === "gate") continue;
    const s = v as ReturnType<typeof summarize>;
    console.log(`${k}: ${s.candidates} candidates, ${s.spots.stated} stated spots (+${s.spots.withoutStatedCount} uncounted), new prefectures [${s.newPrefectures.join(", ")}]`);
  }
  console.log(`gate current passing: ${report.gate.currentPassing.length}`);
  console.log(`gate best-case candidate: ${report.gate.bestCaseCandidate.join(", ") || "none"}`);
  console.log(`gate best-case reviewRequired: ${report.gate.bestCaseReviewRequired.join(", ") || "none"}`);
}
