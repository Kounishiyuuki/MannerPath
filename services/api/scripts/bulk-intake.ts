// Batch triage of official listings (src/pipeline/bulk-intake.ts). Read-only, local only; nothing is written anywhere.
//
//   1. batch.json: { "sourceId", "checkedAt", "rows": [{ id, name, officialAddress, prefecture, municipality, operation, sourceUrl }] }
//   2. npm run bulk:intake -- addresses batch.json > addresses.txt     (one verbatim address per addressed row, in order)
//   3. Outside the repository, with Node ≤23:  abrg addresses.txt -d <pinned ABR dir> -f json > abrg.json   (no --fuzzy)
//   4. npm run bulk:intake -- evaluate batch.json abrg.json [--rows]
import { readFileSync } from "node:fs";
import { ADDRESS_ANCHOR_DATASET_RELEASE, type GeocodeRun, abrJsonRun } from "../src/pipeline/address-anchor.ts";
import { type IntakeBatch, evaluateIntakeBatch } from "../src/pipeline/bulk-intake.ts";

const GEOCODER_VERSION = "2.3.1";

const addressed = (batch: IntakeBatch) => batch.rows.filter((r) => (r.officialAddress ?? "").trim() !== "");

export function geocoderInput(batch: IntakeBatch): string {
  for (const r of addressed(batch)) if (/[\r\n]/.test(r.officialAddress!)) throw new Error(`bulk intake: ${r.id} address spans lines`);
  return addressed(batch).map((r) => r.officialAddress!.trim()).join("\n") + "\n";
}

/** Pairs geocoder output with rows by order and refuses any misalignment rather than guessing. */
export function geocodesByRow(batch: IntakeBatch, abrOutput: readonly unknown[]): Map<string, GeocodeRun> {
  const rows = addressed(batch);
  if (rows.length !== abrOutput.length) throw new Error(`bulk intake: ${rows.length} addressed rows but ${abrOutput.length} geocoder results`);
  return new Map(rows.map((r, i) => {
    const run = abrJsonRun(abrOutput[i], GEOCODER_VERSION, ADDRESS_ANCHOR_DATASET_RELEASE);
    if (run.input !== r.officialAddress!.trim()) throw new Error(`bulk intake: ${r.id} geocoder input ${JSON.stringify(run.input)} is not its official address`);
    return [r.id, run];
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, batchPath, abrPath] = process.argv.slice(2);
  if (!batchPath || (command !== "addresses" && command !== "evaluate") || (command === "evaluate" && !abrPath)) {
    throw new Error("usage: bulk-intake.ts addresses <batch.json> | evaluate <batch.json> <abrg.json> [--rows]");
  }
  const batch = JSON.parse(readFileSync(batchPath, "utf8")) as IntakeBatch;
  if (command === "addresses") process.stdout.write(geocoderInput(batch));
  else {
    const summary = evaluateIntakeBatch(batch, geocodesByRow(batch, JSON.parse(readFileSync(abrPath!, "utf8"))));
    const { results, ...counts } = summary;
    console.log(JSON.stringify(process.argv.includes("--rows") ? summary : { datasetRelease: ADDRESS_ANCHOR_DATASET_RELEASE, ...counts }, null, 2));
  }
}
