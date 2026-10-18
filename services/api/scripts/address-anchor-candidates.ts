// Evaluates official-address anchor candidates (ADR-0018 D-A, src/pipeline/address-anchor.ts). Read-only, local only.
//
//   1. Write the publishers' addresses verbatim, one per line, in candidates.json order (no edits, no fill-ins).
//   2. Outside the repository, with Node ≤23:  npx @digital-go-jp/abr-geocoder@2.3.1 download -d <dir> -c <lgCodes> --keep
//      then  abrg addresses.txt -d <dir> -f json > abrg.json   (no --fuzzy)
//   3. npm run address:anchors -- candidates.json abrg.json
//
// candidates.json: [{ "id", "officialAddress" (null when the page gives none), "prefecture", "municipality" }].
// Prints one evaluation per candidate; nothing is written to any database or fixture.
import { readFileSync } from "node:fs";
import { ADDRESS_ANCHOR_DATASET_RELEASE, abrJsonRun, evaluateAddressAnchor } from "../src/pipeline/address-anchor.ts";

const GEOCODER_VERSION = "2.3.1";

interface Candidate { id: string; officialAddress: string | null; prefecture: string; municipality: string }

export function evaluateCandidates(candidates: readonly Candidate[], abrOutput: readonly unknown[]) {
  const runs = abrOutput.map((item) => abrJsonRun(item, GEOCODER_VERSION, ADDRESS_ANCHOR_DATASET_RELEASE));
  let next = 0;
  const results = candidates.map((c) => {
    // Addresses were geocoded in order; a candidate without an address was never sent to the geocoder.
    const run = c.officialAddress === null || c.officialAddress.trim() === "" ? null : runs[next++] ?? null;
    if (run !== null && run.input !== c.officialAddress!.trim()) throw new Error(`address anchors: ${c.id} geocoder input ${JSON.stringify(run.input)} is not its official address`);
    return { id: c.id, ...evaluateAddressAnchor({ officialAddress: c.officialAddress, expectedPrefecture: c.prefecture, expectedMunicipality: c.municipality, geocode: run }) };
  });
  if (next !== runs.length) throw new Error(`address anchors: ${runs.length - next} geocoder results have no candidate`);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [candidatesPath, abrPath] = process.argv.slice(2);
  if (!candidatesPath || !abrPath) throw new Error("usage: address-anchor-candidates.ts <candidates.json> <abrg.json>");
  const results = evaluateCandidates(JSON.parse(readFileSync(candidatesPath, "utf8")), JSON.parse(readFileSync(abrPath, "utf8")));
  const pending: Record<string, number> = {};
  for (const r of results) if (r.status === "reviewPending") for (const reason of r.reasons) pending[reason] = (pending[reason] ?? 0) + 1;
  console.log(JSON.stringify({ datasetRelease: ADDRESS_ANCHOR_DATASET_RELEASE, candidates: results.length,
    anchors: results.filter((r) => r.status === "anchor").length, pendingReasons: pending, results }, null, 2));
}
