// LOCAL PoC benchmark of the v3 binary photo route (src/poc/binary-photo, not mounted by createApp).
//   node --experimental-strip-types --experimental-sqlite --no-warnings scripts/photo-v3-cpu-poc.ts <dir-of-client-jpegs>
// Process CPU per request in Node (not workerd). node:sqlite runs in-process for both REPORTS_DB and PHOTOS_DB, so
// database work — including copying the BLOB — is counted here; on D1 the query runs outside the isolate, but
// serializing the bound BLOB still costs the Worker something that this cannot reproduce.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harness } from "../test/support/binary-photo-harness.ts";

async function cpu<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const start = process.cpuUsage(); const value = await fn(); const used = process.cpuUsage(start);
  return [(used.user + used.system) / 1000, value];
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const RUNS = 11;

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: photo-v3-cpu-poc.ts <dir-of-client-jpegs>");
  const h = await harness(), device = await h.enrol();
  console.log("file | bytes | v3 route CPU median (min–max) | runs over 10 ms");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort()) {
    const image = new Uint8Array(readFileSync(join(dir, file)));
    const xs: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const reportId = await h.newReport(device); // fresh report: the 3-photo cap never short-circuits
      const body = await h.body(device, reportId, image);
      const [ms, res] = await cpu(() => h.request(reportId, body));
      if (res.status !== 201) throw new Error(`${file}: ${res.status} ${await res.text()}`);
      if (run > 0) xs.push(ms); // first run warms the JIT
    }
    const over = xs.filter((x) => x > 10).length;
    console.log(`${file} | ${image.length} | ${median(xs).toFixed(1)} ms (${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}) | ${over}/${xs.length}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
