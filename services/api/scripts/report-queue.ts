// Local moderation tool for user reports (ADR-0007 §8). It talks to the LOCAL D1 database
// (.wrangler/state) only, never a remote one, and there is no authenticated admin HTTP surface.
//
//   npm run local:reports                                   # pending queue
//   npm run local:reports -- list accepted
//   npm run local:reports -- decide rp_... accepted reviewer-1 "写真と一致"
//   npm run local:reports -- queue rp_... queued
//   npm run local:reports -- retain                          # run the retention/minimization pass
//
// The queue view prints the claim under review; it never prints the hashed submitter key, and no
// raw install identifier or attestation material exists in the database to print.
import { getPlatformProxy } from "wrangler";
import type { Db } from "../src/db.ts";
import {
  type ModerationState,
  type ReconciliationState,
  listModerationQueue,
  recordModerationDecision,
  setReconciliationState,
} from "../src/reports/moderation.ts";
import { applyReportRetention } from "../src/reports/retention.ts";

const [command = "list", ...args] = process.argv.slice(2);
const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
try {
  const db = proxy.env.DB;
  const now = new Date();
  if (command === "list") {
    console.log(JSON.stringify(await listModerationQueue(db, { state: (args[0] as ModerationState) ?? "pending" }), null, 2));
  } else if (command === "decide") {
    const [reportId, state, decidedBy, note] = args;
    if (!reportId || !state || !decidedBy) throw new Error("usage: decide <reportId> <state> <decidedBy> [note]");
    await recordModerationDecision(db, reportId, { state: state as Exclude<ModerationState, "pending">, decidedBy, note, now });
    console.log(JSON.stringify(await listModerationQueue(db, { state: state as ModerationState }), null, 2));
  } else if (command === "queue") {
    const [reportId, state] = args;
    if (!reportId || !state) throw new Error("usage: queue <reportId> <notQueued|queued|applied|discarded>");
    // Rejected by the database unless the report is accepted; queuing is still not publication.
    await setReconciliationState(db, reportId, state as ReconciliationState, now);
    console.log("reconciliation", reportId, state);
  } else if (command === "retain") {
    console.log("retention", await applyReportRetention(db, { now }));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} finally {
  await proxy.dispose();
}
