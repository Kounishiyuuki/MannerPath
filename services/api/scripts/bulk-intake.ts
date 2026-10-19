// Batch triage of official listings (src/pipeline/bulk-intake.ts). Read-only, local only; nothing is written anywhere.
//
//   1. batch.json: { "sourceId", "checkedAt", "rows": [{ id, name, officialAddress, prefecture, municipality, operation, sourceUrl }] }
//   2. npm run bulk:intake -- addresses batch.json > addresses.txt     (one verbatim address per addressed row, in order)
//   3. Outside the repository, with Node ≤23:  abrg addresses.txt -d <pinned ABR dir> -f json > abrg.json   (no --fuzzy)
//   4. npm run bulk:intake -- evaluate batch.json abrg.json --dataset <pinned ABR dir> [--release <id>] [--rows]
//      The directory must reproduce the pinned release digest (scripts/address-anchor-dataset.ts), or nothing is evaluated.
//   Row prefecture/municipality are the source's publishing municipality: a cell may be completed only with it (F3).
import { readFileSync } from "node:fs";
import { type GeocodeRun, abrJsonRun, completeOfficialAddress } from "../src/pipeline/address-anchor.ts";
import { verifyRegisteredDatasetDir } from "./address-anchor-dataset.ts";
import { type IntakeBatch, evaluateIntakeBatch } from "../src/pipeline/bulk-intake.ts";

const GEOCODER_VERSION = "2.3.1";

/** Rows whose cell completes within the source's scope, with the geocoder input; out-of-scope rows are never geocoded. */
const addressed = (batch: IntakeBatch) => batch.rows.flatMap((r) => {
  const completed = r.officialAddress === null ? null : completeOfficialAddress(r.officialAddress, r);
  return completed === null ? [] : [{ id: r.id, input: completed.address }];
});

export function geocoderInput(batch: IntakeBatch): string {
  for (const r of addressed(batch)) if (/[\r\n]/.test(r.input)) throw new Error(`bulk intake: ${r.id} address spans lines`);
  return addressed(batch).map((r) => r.input).join("\n") + "\n";
}

/** Pairs geocoder output with rows by order and refuses any misalignment rather than guessing. */
/** `datasetReleaseId` must come from verifyDatasetDir: an unverified directory never names the pinned release. */
export function geocodesByRow(batch: IntakeBatch, abrOutput: readonly unknown[], datasetReleaseId: string): Map<string, GeocodeRun> {
  const rows = addressed(batch);
  if (rows.length !== abrOutput.length) throw new Error(`bulk intake: ${rows.length} addressed rows but ${abrOutput.length} geocoder results`);
  return new Map(rows.map((r, i) => {
    const run = abrJsonRun(abrOutput[i], GEOCODER_VERSION, datasetReleaseId);
    if (run.input !== r.input) throw new Error(`bulk intake: ${r.id} geocoder input ${JSON.stringify(run.input)} is not its official address`);
    return [r.id, run];
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, batchPath, abrPath] = process.argv.slice(2);
  const datasetDir = process.argv.includes("--dataset") ? process.argv[process.argv.indexOf("--dataset") + 1] : undefined;
  const releaseArg = process.argv.includes("--release") ? process.argv[process.argv.indexOf("--release") + 1] : undefined;
  if (!batchPath || (command !== "addresses" && command !== "evaluate") || (command === "evaluate" && (!abrPath || !datasetDir))) {
    throw new Error("usage: bulk-intake.ts addresses <batch.json> | evaluate <batch.json> <abrg.json> --dataset <abr dir> [--rows]");
  }
  const batch = JSON.parse(readFileSync(batchPath, "utf8")) as IntakeBatch;
  if (command === "addresses") process.stdout.write(geocoderInput(batch));
  else {
    const release = verifyRegisteredDatasetDir(datasetDir!, releaseArg);
    const summary = evaluateIntakeBatch(batch, geocodesByRow(batch, JSON.parse(readFileSync(abrPath!, "utf8")), release));
    const { results, ...counts } = summary;
    console.log(JSON.stringify(process.argv.includes("--rows") ? summary : { datasetRelease: release, ...counts }, null, 2));
  }
}
