// Evaluates official-address anchor candidates (ADR-0018 D-A, src/pipeline/address-anchor.ts). Read-only, local only.
//
//   1. candidates.json: [{ "id", "officialAddress" (the page's cell verbatim; null when none), "prefecture", "municipality" }]
//      where prefecture/municipality are the SOURCE's publishing municipality (completeOfficialAddress).
//   2. npm run address:anchors -- addresses candidates.json > addresses.txt
//   3. Outside the repository:  npx @digital-go-jp/abr-geocoder@2.3.1 download -d <dir> -c <lgCodes> --keep
//      then  abrg addresses.txt -d <dir> -f json > abrg.json   (no --fuzzy).
//      Observed 2026-10-18: download + geocode on Node 23.3.0; geocode on Node 22.23.3 (clean install) byte-identical to
//      23.3.0 over 175 addresses. Download on Node 22 was not run. Node 24 fails (uWebSockets.js). No other version is claimed.
//   4. npm run address:anchors -- evaluate candidates.json abrg.json --dataset <dir>
//      <dir> must reproduce the pinned release digest (scripts/address-anchor-dataset.ts), or nothing is evaluated.
// Prints one evaluation per candidate; nothing is written to any database or fixture.
import { readFileSync } from "node:fs";
import { abrJsonRun, completeOfficialAddress, evaluateAddressAnchor } from "../src/pipeline/address-anchor.ts";
import { verifyDatasetDir } from "./address-anchor-dataset.ts";

const GEOCODER_VERSION = "2.3.1";

interface Candidate { id: string; officialAddress: string | null; prefecture: string; municipality: string }

const geocoderInputOf = (c: Candidate) => c.officialAddress === null || c.officialAddress.trim() === "" ? null
  : completeOfficialAddress(c.officialAddress, c)?.address ?? null;

export function candidateAddresses(candidates: readonly Candidate[]): string {
  const lines = candidates.map(geocoderInputOf).filter((a): a is string => a !== null);
  if (lines.some((a) => /[\r\n]/.test(a))) throw new Error("address anchors: an address spans lines");
  return lines.join("\n") + "\n";
}

/** `datasetReleaseId` must come from verifyDatasetDir: an unverified directory never names the pinned release. */
export function evaluateCandidates(candidates: readonly Candidate[], abrOutput: readonly unknown[], datasetReleaseId: string) {
  const runs = abrOutput.map((item) => abrJsonRun(item, GEOCODER_VERSION, datasetReleaseId));
  let next = 0;
  const results = candidates.map((c) => {
    const input = geocoderInputOf(c);
    if (input === null && c.officialAddress !== null && c.officialAddress.trim() !== "") {
      return { id: c.id, status: "reviewPending" as const, reasons: ["outsideSourceScope"] };
    }
    // Addresses were geocoded in order; a candidate without an in-scope address was never sent to the geocoder.
    const run = input === null ? null : runs[next++] ?? null;
    if (run !== null && run.input !== input) throw new Error(`address anchors: ${c.id} geocoder input ${JSON.stringify(run.input)} is not its official address`);
    return { id: c.id, ...evaluateAddressAnchor({ officialAddress: input, expectedPrefecture: c.prefecture, expectedMunicipality: c.municipality, geocode: run }) };
  });
  if (next !== runs.length) throw new Error(`address anchors: ${runs.length - next} geocoder results have no candidate`);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, candidatesPath, abrPath] = process.argv.slice(2);
  const datasetDir = process.argv.includes("--dataset") ? process.argv[process.argv.indexOf("--dataset") + 1] : undefined;
  if (command === "addresses" && candidatesPath) {
    process.stdout.write(candidateAddresses(JSON.parse(readFileSync(candidatesPath, "utf8"))));
  } else if (command === "evaluate" && candidatesPath && abrPath && datasetDir) {
    const release = verifyDatasetDir(datasetDir);
    const results = evaluateCandidates(JSON.parse(readFileSync(candidatesPath, "utf8")), JSON.parse(readFileSync(abrPath, "utf8")), release);
    const pending: Record<string, number> = {};
    for (const r of results) if (r.status === "reviewPending") for (const reason of r.reasons) pending[reason] = (pending[reason] ?? 0) + 1;
    console.log(JSON.stringify({ datasetRelease: release, candidates: results.length,
      anchors: results.filter((r) => r.status === "anchor").length, pendingReasons: pending, results }, null, 2));
  } else {
    throw new Error("usage: address-anchor-candidates.ts addresses <candidates.json> | evaluate <candidates.json> <abrg.json> --dataset <abr dir>");
  }
}
