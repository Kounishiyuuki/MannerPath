// Community publication activation (Issue #124, Issue #150). Applies the maintainer decision recorded in
// src/reports/community-publication.ts to the LOCAL D1 database. It never approves anything and never talks to a
// remote database: production receives the result as a reviewed promotion bundle (docs/OPERATIONS.md, community
// launch), exactly like every other registry change.
//
//   npm run community:status                                   # read-only: the decision, its problems, what would apply
//   npm run community:activate -- --terms-version <version>    # refuses unless the decision says approved for <version>
//
// After activate: npm run local:pipeline (republish), then npm run local:quality and the promotion export.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { type Db, isoSeconds } from "../src/db.ts";
import { COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { applyReviewedSourceRegistry } from "../src/pipeline/registry.ts";
import { COMMUNITY_PUBLICATION, decisionProblems, decisionSourceFields, decisionTerms, planActivation } from "../src/reports/community-publication.ts";
import { REPORT_TERMS, applyReportTermsRegistry } from "../src/reports/terms.ts";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const repoFile = (path: string): Uint8Array | null => {
  try {
    return readFileSync(new URL(`../../../${path}`, import.meta.url));
  } catch {
    return null;
  }
};

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const decision = COMMUNITY_PUBLICATION;
const document = decision.state === "pending" ? null : repoFile(decision.documentPath);

if (command === "status") {
  console.log(JSON.stringify({
    decision,
    problems: decisionProblems(decision, document, sha256),
    reportTerms: REPORT_TERMS.map((t) => ({ version: t.version, publicationRights: t.publicationRights })),
    decisionTerms: decisionTerms(decision),
    communitySource: { sourceId: COMMUNITY_SOURCE_ID, ...decisionSourceFields(decision) },
  }, null, 2));
} else if (command === "activate") {
  const plan = planActivation(decision, flag("--terms-version"), document, sha256);
  if (!plan.ok) {
    console.error(`community:activate refused:\n- ${plan.problems.join("\n- ")}`);
    process.exit(1);
  }
  const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
  try {
    const now = isoSeconds(new Date());
    console.log("report terms", await applyReportTermsRegistry(proxy.env.DB, now));
    console.log(COMMUNITY_SOURCE_ID, await applyReviewedSourceRegistry(proxy.env.DB, COMMUNITY_SOURCE_ID, now));
    console.log("next: npm run local:pipeline && npm run local:quality, then the promotion export (docs/OPERATIONS.md)");
  } finally {
    await proxy.dispose();
  }
} else {
  console.error("usage: community-activation.ts status | activate --terms-version <version>");
  process.exit(2);
}
