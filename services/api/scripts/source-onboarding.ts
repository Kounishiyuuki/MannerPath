// Local advisory tooling only: no database, network, registry writes or publication.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { manualReviewTriage } from "../../data-pipeline/discovery/evaluator.mjs";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { observeSourceRecord } from "../src/pipeline/source-adapter.ts";
import { TAITO_FIXTURE_RELEASE } from "../src/pipeline/taito.ts";
import { OSAKA_FIXTURE_RELEASE } from "../src/pipeline/osaka-adapter.ts";
import { KOTO_FIXTURE_RELEASE } from "../src/pipeline/koto-adapter.ts";
import { MUSASHINO_FIXTURE_RELEASE } from "../src/pipeline/musashino-adapter.ts";
import { MINATO_FIXTURE_RELEASE } from "../src/pipeline/minato-adapter.ts";
import { KYOTO_FIXTURE_RELEASE } from "../src/pipeline/kyoto-adapter.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourceIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(100);
const text = z.string().trim().min(1);
const url = z.url().refine(value => /^https?:\/\//.test(value), "HTTP(S) URL required");
const resourceSchema = z.object({
  rawUrl: url.nullable().default(null), publisher: text.nullable().default(null),
  licenseMetadata: text.nullable().default(null), attributionMetadata: text.nullable().default(null),
  matchingRowCount: z.number().int().nonnegative().nullable().default(null),
  coordinateAvailability: z.enum(["all", "partial", "none", "unknown"]).default("unknown"),
  coordinateColumns: z.array(text).default([]), externalReferenceOnly: z.boolean().default(false),
  blockerCodes: z.array(text).default([]), truncated: z.boolean().default(false),
}).strict();
const gateSchema = z.object({
  exactDataset: url.optional(), exactApplicableLicense: z.boolean().optional(),
  redistributionAllowed: z.boolean().optional(), derivationAllowed: z.boolean().optional(),
  publisherCoordinates: z.boolean().optional(), currentOperationEvidence: z.boolean().optional(),
}).strict();
export const candidateSchema = z.object({
  sourceId: sourceIdSchema, publicationStatus: z.literal("blocked").default("blocked"),
  resource: resourceSchema, review: z.object({
    reviewedBy: text.optional(), reviewedOn: z.iso.date().optional(),
    approvalGate: gateSchema.default({}),
    officialPublisher: z.boolean().optional(), smokingExistence: z.boolean().optional(),
    commercialReuse: z.boolean().optional(), coordinateAuthorityReviewed: z.boolean().optional(),
    coordinateKind: z.enum(["publisherPoint", "areaApproximate", "reviewedDerived", "unknown"]).default("unknown"),
    licenseName: text.optional(), licenseUrl: url.optional(),
    evidenceReference: text.optional(),
  }).strict().default({ approvalGate: {}, coordinateKind: "unknown" }),
}).strict();
const inputSchema = z.object({ version: z.literal(1), sources: z.array(candidateSchema) }).strict();
export type Candidate = z.input<typeof candidateSchema>;

// Pins of already reviewed releases, not a new approval registry or a latest-live-release claim.
const pins = [
  ["taito-public-smoking-areas", "20260818_koshukitsuenjo.csv", TAITO_FIXTURE_RELEASE, "taito-reconciliation.test.ts"],
  ["osaka-designated-smoking-areas", "opendata_1012.csv", OSAKA_FIXTURE_RELEASE, "osaka-source.test.ts"],
  ["koto-station-smoking-areas", "131083_237_public_smoking_area_station.csv", KOTO_FIXTURE_RELEASE, "koto-source.test.ts"],
  ["musashino-public-smoking-areas", "doc.kml", MUSASHINO_FIXTURE_RELEASE, "musashino-source.test.ts"],
  ["minato-designated-smoking-areas", "minatokushisetsujoho_fukugo.csv", MINATO_FIXTURE_RELEASE, "minato-source.test.ts"],
  ["kyoto-public-smoking-places", "20260903_shisetsu.csv", KYOTO_FIXTURE_RELEASE, "kyoto-source.test.ts"],
] as const;
export const ONBOARDING_STATES = ["DISCOVERED", "RIGHTS_REVIEW_REQUIRED", "RIGHTS_REVIEWED",
  "COORDINATE_AUTHORITY_REQUIRED", "COORDINATE_AUTHORITY_REVIEWED", "ADAPTER_REQUIRED",
  "FIXTURE_REQUIRED", "IMPLEMENTATION_REVIEW_REQUIRED", "LOCAL_PIPELINE_READY", "BLOCKED"] as const;

export function evaluateCandidate(input: Candidate) {
  const c = candidateSchema.parse(input);
  const triage = manualReviewTriage(c.resource, { review: c.review });
  const r = c.review, gate = r.approvalGate;
  const reviewed = !!r.reviewedBy && !!r.reviewedOn && !!r.evidenceReference;
  const scoped = gate.exactDataset === c.resource.rawUrl && c.resource.rawUrl !== null;
  const rights = reviewed && scoped && triage.rights === "explicit-review-signal" &&
    r.commercialReuse === true && !!r.licenseName && !!r.licenseUrl;
  const coordinates = reviewed && scoped && r.coordinateAuthorityReviewed === true &&
    r.coordinateKind === "publisherPoint" && gate.publisherCoordinates === true &&
    triage.coordinates === "available-signal" && c.resource.coordinateColumns.length > 0 &&
    triage.classification !== "EXTERNAL_REFERENCE_ONLY";
  const blockers: string[] = [...triage.blockerCodes];
  if (c.resource.externalReferenceOnly) blockers.push("externalReferenceOnly");
  if (triage.smokingEvidence === "no-point-evidence") blockers.push("noSmokingPointEvidence");
  if (!reviewed || !scoped || r.officialPublisher !== true || !c.resource.publisher) blockers.push("officialPublisherReviewRequired");
  if (!reviewed || !scoped || r.smokingExistence !== true) blockers.push("smokingExistenceReviewRequired");
  if (!rights) blockers.push("rightsReviewRequired");
  if (!coordinates) blockers.push("coordinateAuthorityReviewRequired");
  if (r.coordinateKind === "reviewedDerived") blockers.push("derivedPublicationNotApproved");
  if (r.coordinateKind === "areaApproximate") blockers.push("reviewedAreaAnchorImplementationRequired");
  if (!reviewed || !scoped || gate.currentOperationEvidence !== true) blockers.push("operationReviewRequired");
  if (c.resource.truncated) blockers.push("truncatedDiscovery");
  const missing = [...new Set(blockers)];
  const state = missing.length ? "BLOCKED" : "ADAPTER_REQUIRED";
  return {
    sourceId: c.sourceId, state, approvalAutomated: false, productionApproval: false,
    publicationStatus: "blocked", publisher: c.resource.publisher, resourceUrl: c.resource.rawUrl,
    smokingEvidence: { status: reviewed && scoped && r.smokingExistence === true ? "human-review-signal" : "unknown", reference: r.evidenceReference ?? null },
    rights: { status: rights ? "RIGHTS_REVIEWED" : "RIGHTS_REVIEW_REQUIRED", licenseName: r.licenseName ?? null,
      licenseUrl: r.licenseUrl ?? null, metadata: c.resource.licenseMetadata, commercialReuse: r.commercialReuse ?? "unknown" },
    attribution: c.resource.attributionMetadata,
    coordinates: { status: coordinates ? "COORDINATE_AUTHORITY_REVIEWED" : "COORDINATE_AUTHORITY_REQUIRED",
      kind: coordinates ? "publisherPoint" : r.coordinateKind === "publisherPoint" ? "unknown" : r.coordinateKind,
      requestedKind: r.coordinateKind, columns: c.resource.coordinateColumns },
    operation: reviewed && scoped && gate.currentOperationEvidence === true ? "human-review-signal" : "unknown",
    review: { reviewedBy: r.reviewedBy ?? null, reviewedOn: r.reviewedOn ?? null },
    adapter: false, fixture: false, registryEntry: false, tests: false,
    pinnedRelease: null, latestLiveRelease: "unknown", quality: "notEvaluated", promotion: "notEvaluated",
    discovery: triage, drift: { status: "notObserved", changes: [] as string[] },
    blockers: missing, nextAction: missing.length ? "Resolve listed human review gates; do not implement or publish from signals." :
      "Human implementation review: adapter, licensed fixture, tests and docs/SOURCES.md PR. No source approval granted.",
  };
}

/** Consume discovery output, never rescan/reinterpret permissions or mint a canonical source ID. */
export function discoveryCandidates(input: unknown) {
  const report = z.object({ resources: z.array(z.object({ rawUrl: url }).passthrough()),
    manualReviewQueue: z.array(z.object({ candidate: z.string(), classification: z.string(),
      blockerCodes: z.array(text).optional() }).passthrough()).optional(),
    targets: z.array(z.object({ resourceUrls: z.array(z.string()).default([]),
      blockerCodes: z.array(text).optional(), truncated: z.boolean().optional() }).passthrough()).optional(),
  }).passthrough().parse(input);
  return report.resources.map(resource => {
    const linkedTargets = report.targets?.filter(target => target.resourceUrls.includes(resource.rawUrl)) ?? [];
    const queueItems = report.manualReviewQueue?.filter(item => item.candidate === resource.rawUrl) ?? [];
    const external = z.boolean().parse(resource.externalReferenceOnly ?? false) || report.manualReviewQueue?.some(
      item => item.candidate === resource.rawUrl && item.classification === "EXTERNAL_REFERENCE_ONLY") === true;
    return candidateSchema.parse({
      // A queue reference only. A human chooses the permanent reviewed adapter source ID later.
      sourceId: "discovery-" + createHash("sha256").update(resource.rawUrl).digest("hex").slice(0, 16),
      resource: { rawUrl: resource.rawUrl, publisher: resource.publisher ?? null,
        licenseMetadata: resource.licenseMetadata ?? null, attributionMetadata: resource.attributionMetadata ?? null,
        matchingRowCount: resource.matchingRowCount ?? null,
        coordinateAvailability: resource.coordinateAvailability ?? "unknown",
        coordinateColumns: resource.coordinateColumns ?? [],
        blockerCodes: [...new Set([...z.array(text).parse(resource.blockerCodes ?? []),
          ...queueItems.flatMap(item => item.blockerCodes ?? []),
          ...linkedTargets.flatMap(target => target.blockerCodes ?? [])])],
        truncated: z.boolean().parse(resource.truncated ?? false) || linkedTargets.some(target => target.truncated === true), externalReferenceOnly: external },
    });
  });
}

export function inspectReviewedSources(repositoryRoot = root) {
  const sourceDocs = readFileSync(resolve(repositoryRoot, "docs/SOURCES.md"), "utf8");
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "services/data-pipeline/discovery/manifest.json"), "utf8"));
  return SOURCE_ADAPTERS.map(adapter => {
    const id = adapter.registry.sourceId;
    const pin = pins.find(p => p[0] === id);
    const directory = resolve(repositoryRoot, "services/data-pipeline/fixtures", id);
    const fixtureFile = pin ? resolve(directory, pin[1]) : null;
    const checks = {
      registryEntry: adapter.registry.publicationStatus === "approved" && sourceDocs.includes('`' + id + '`'),
      fixture: !!fixtureFile && existsSync(fixtureFile) && existsSync(resolve(directory, "PROVENANCE.md")),
      tests: !!pin && existsSync(resolve(repositoryRoot, "services/api/test", pin[3])),
      discoveryMetadata: manifest.targets.some((t: { reviewedSourceIds?: string[] }) => t.reviewedSourceIds?.includes(id)),
    };
    const blockers: string[] = [];
    for (const [key, present] of Object.entries(checks)) if (!present) blockers.push(`${key}Missing`);
    const registry = adapter.registry;
    if (!registry.licenseName || !registry.licenseUrl || !registry.attributionText) blockers.push("rightsMetadataMissing");
    let header: string[] = [], columns: string[] = [], rawRows: number | null = null, observedRows: number | null = null;
    let digest: string | null = null;
    if (fixtureFile && checks.fixture && pin) {
      try {
        const bytes = new Uint8Array(readFileSync(fixtureFile));
        digest = createHash("sha256").update(bytes).digest("hex");
        const parsed = adapter.parse(bytes); header = parsed.header; rawRows = parsed.rows.length;
        const observations = parsed.rows.filter(row => !adapter.includesRecord || adapter.includesRecord(row))
          .map(row => observeSourceRecord(adapter, row));
        observedRows = observations.length;
        columns = [...new Set(observations.flatMap(o => o.provenance.filter(p => p.field === "location").flatMap(p => p.columns)))];
        adapter.assertResolvable({ ...pin[2], contentSha256: digest }, observations);
      } catch (error) { blockers.push(`fixtureValidationFailed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return {
      sourceId: id, state: blockers.length ? "BLOCKED" : "LOCAL_PIPELINE_READY",
      approvalAutomated: false, productionApproval: false, publicationStatus: registry.publicationStatus,
      publisher: registry.displayName, resourceUrl: pin?.[2].sourceUrl ?? null,
      smokingEvidence: { status: "existing-repository-review", reference: "docs/SOURCES.md" },
      rights: { status: "RIGHTS_REVIEWED", licenseName: registry.licenseName, licenseUrl: registry.licenseUrl,
        metadata: "Existing reviewed registry, not newly inferred permission", commercialReuse: "see docs/SOURCES.md" },
      attribution: registry.attributionText, coordinates: { status: "COORDINATE_AUTHORITY_REVIEWED", kind: "publisherPoint", columns },
      operation: "pinned-release review only; latest live operation unknown",
      adapter: true, ...checks,
      pinnedRelease: pin ? { ...pin[2], contentSha256: digest, file: pin[1], rawRows, observedRows } : null,
      latestLiveRelease: "unknown", quality: "notEvaluated", promotion: "notEvaluated",
      baseline: { rawUrl: pin?.[2].sourceUrl ?? null, header, coordinateColumns: columns,
        licenseName: registry.licenseName, licenseUrl: registry.licenseUrl, attributionMetadata: registry.attributionText },
      drift: { status: "notObserved", changes: [] as string[] },
      refreshTarget: adapter.refreshTarget?.url ?? null,
      blockers, nextAction: blockers.length ? "Review missing/corrupt implementation evidence." :
        `Run fresh local:pipeline -- ${id}, local:quality and verified promotion; READY is not production approval.`,
    };
  });
}

const observationSchema = z.object({
  sourceId: sourceIdSchema, rawUrl: url.optional(), header: z.array(z.string()).optional(),
  coordinateColumns: z.array(text).optional(), licenseName: text.optional(), licenseUrl: url.optional(),
  attributionMetadata: text.optional(), resourceAvailable: z.boolean().optional(),
}).strict();
export function compareDrift(baseline: Record<string, unknown>, observation: unknown) {
  const o = observationSchema.parse(observation);
  const changes = Object.keys(o).filter(key => key !== "sourceId" && key !== "resourceAvailable" &&
    JSON.stringify(o[key as keyof typeof o]) !== JSON.stringify(baseline[key]));
  if (o.resourceAvailable === false) changes.push("resourceDisappearance");
  return { status: changes.length ? "detected" : "suppliedFieldsUnchanged", changes,
    unobservedFields: [...Object.keys(baseline), "resourceAvailable"].filter(key => !Object.hasOwn(o, key)) };
}

export function buildQueue(packets: (ReturnType<typeof evaluateCandidate> | ReturnType<typeof inspectReviewedSources>[number])[]) {
  const sorted = [...packets].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return {
    needsRightsReview: sorted.filter(p => p.blockers.includes("rightsReviewRequired")).map(p => p.sourceId),
    needsCoordinateReview: sorted.filter(p => p.blockers.includes("coordinateAuthorityReviewRequired")).map(p => p.sourceId),
    adapterMissing: sorted.filter(p => !p.adapter).map(p => p.sourceId),
    fixtureMissing: sorted.filter(p => !p.fixture).map(p => p.sourceId),
    testsMissing: sorted.filter(p => !p.tests).map(p => p.sourceId),
    driftDetected: sorted.filter(p => p.drift.status === "detected").map(p => p.sourceId),
    blocked: sorted.filter(p => p.state === "BLOCKED").map(p => p.sourceId),
    readyForLocalImplementationReview: sorted.filter(p => p.state === "ADAPTER_REQUIRED").map(p => p.sourceId),
    readyForLocalValidation: sorted.filter(p => p.state === "LOCAL_PIPELINE_READY").map(p => p.sourceId),
    needsQualityEvidence: sorted.filter(p => p.quality === "notEvaluated").map(p => p.sourceId),
    needsPromotionEvidence: sorted.filter(p => p.promotion === "notEvaluated").map(p => p.sourceId),
  };
}

export function markdownPacket(report: { scope: string; queue: Record<string, string[]>; sources: unknown[] }) {
  const safe = (value: unknown) => JSON.stringify(value, null, 2).replace(/`/g, "\\u0060");
  return `# Source onboarding review packet\n\n${report.scope}\n\n` +
    Object.entries(report.queue).map(([name, ids]) => `## ${name}\n\n${ids.length ? ids.map(id => `- ${id}`).join("\n") : "None"}\n`).join("\n") +
    report.sources.map(source => `\n## ${(source as {sourceId: string}).sourceId}\n\n\`\`\`json\n${safe(source)}\n\`\`\`\n`).join("");
}

export function scaffoldSource(sourceId: string, outputParent: string) {
  sourceIdSchema.parse(sourceId);
  if (SOURCE_ADAPTERS.some(a => a.registry.sourceId === sourceId)) throw new Error("scaffold: already reviewed source");
  const destination = resolve(outputParent, sourceId);
  // Exclusive directory creation: no overwriting existing files or following an existing source directory.
  mkdirSync(destination);
  mkdirSync(resolve(destination, "fixtures"));
  const packet = candidateSchema.parse({ sourceId, resource: {} });
  writeFileSync(resolve(destination, "onboarding.json"), JSON.stringify({ version: 1, sources: [packet] }, null, 2) + "\n", { flag: "wx" });
  writeFileSync(resolve(destination, "adapter.ts"), `// Unregistered review skeleton; never add to SOURCE_ADAPTERS without a reviewed PR.\nexport const registry = { sourceId: ${JSON.stringify(sourceId)}, publicationStatus: "blocked", licenseName: null, licenseUrl: null, attributionText: null };\nexport const rights = "unknown";\nexport const coordinates = "unknown";\nexport function parse(_bytes: Uint8Array): never { throw new Error("Source requires reviewed schema, existence and coordinate mapping"); }\n`, { flag: "wx" });
  writeFileSync(resolve(destination, "adapter.test.ts"), `// Replace with source-specific fixture and gate tests after human review.\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { registry, parse } from "./adapter.ts";\ntest("unreviewed source stays inert", () => { assert.equal(registry.publicationStatus, "blocked"); assert.throws(() => parse(new Uint8Array())); });\n`, { flag: "wx" });
  writeFileSync(resolve(destination, "REVIEW.md"), "# Human source review\n\nPublisher / exact resource URL / smoking evidence / rights / attribution / coordinate authority / operation: UNKNOWN.\n\nNo download or fixture redistribution until rights are reviewed. No geocoding.\nAdd real fixture provenance, adapter interface implementation, release pins, discovery link and meaningful tests in a reviewed PR.\nQuality and promotion require separate local evidence; this skeleton approves nothing.\n", { flag: "wx" });
  return destination;
}

export function run(args: string[]) {
  if (args[0] === "scaffold") {
    if (args.length !== 4 || args[2] !== "--out") throw new Error("Usage: source:scaffold -- <source-id> --out <existing-local-parent>");
    console.log(scaffoldSource(args[1], args[3])); return;
  }
  let sourceId: string | null = null, metadata: string | null = null, discovery: string | null = null, observation: string | null = null, output: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--metadata", "--discovery-report", "--observation", "--out"].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--metadata") metadata = value; else if (arg === "--discovery-report") discovery = value; else if (arg === "--observation") observation = value; else output = value;
    } else if (!arg.startsWith("--") && !sourceId) sourceId = sourceIdSchema.parse(arg);
    else throw new Error(`Unknown argument ${arg}`);
  }
  const candidates = [...(metadata ? inputSchema.parse(JSON.parse(readFileSync(metadata, "utf8"))).sources : []),
    ...(discovery ? discoveryCandidates(JSON.parse(readFileSync(discovery, "utf8"))) : [])];
  const reviewed = inspectReviewedSources();
  const ids = new Set(reviewed.map(p => p.sourceId));
  for (const candidate of candidates) {
    if (ids.has(candidate.sourceId)) throw new Error(`Duplicate/reviewed source id ${candidate.sourceId}; use --observation for drift`);
    ids.add(candidate.sourceId);
  }
  let packets = [...reviewed, ...candidates.map(evaluateCandidate)];
  if (sourceId) {
    packets = packets.filter(p => p.sourceId === sourceId);
    if (!packets.length) throw new Error(`Unknown source ${sourceId}; supply --metadata or scaffold first`);
  }
  if (observation) {
    const supplied = z.array(observationSchema).parse(JSON.parse(readFileSync(observation, "utf8")));
    const seen = new Set<string>();
    for (const o of supplied) {
      if (seen.has(o.sourceId)) throw new Error(`Duplicate observation ${o.sourceId}`); seen.add(o.sourceId);
      const p = packets.find(p => p.sourceId === o.sourceId);
      if (!p || !("baseline" in p)) throw new Error(`No reviewed baseline for ${o.sourceId}`);
      const drift = compareDrift(p.baseline, o); p.drift = drift;
      if (drift.changes.length) { p.state = "BLOCKED"; p.blockers.push("driftDetected"); p.nextAction = "Human review of observed drift; no metadata, rights or publication changes applied."; }
    }
  }
  const report = { version: 1, approvalAutomated: false, productionApproval: false,
    scope: "Offline advisory evidence only. READY is not production approval. Quality/promotion and latest live operation are not evaluated.",
    queue: buildQueue(packets), sources: packets };
  const json = JSON.stringify(report, null, 2) + "\n";
  if (output) {
    // Do not overwrite a review/input artifact. Both output files must be absent before writing.
    const target = resolve(output), markdown = target + ".md";
    if (existsSync(target) || existsSync(markdown)) throw new Error("Output exists; choose a fresh local path");
    writeFileSync(target, json, { flag: "wx" }); writeFileSync(markdown, markdownPacket(report), { flag: "wx" });
  } else console.log(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { run(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
