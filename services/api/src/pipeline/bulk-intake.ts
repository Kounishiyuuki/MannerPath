// Batch triage for official-listing intake (ADR-0018): hundreds of listed places per batch, one decision each.
//
// Read-only. A batch is one reviewed source's normalized listing rows plus their abr-geocoder runs; the output is, per
// row, `adoptable` (could become an areaApproximate fact-sheet row once a maintainer pins it), `needsReview` or
// `rejected`, with reasons, and the counts by reason. Nothing here records anchors, ingests or publishes: adopting rows
// stays the reviewed adapter + fixture path (e.g. chuo-park-adapter.ts), so every existing gate still runs on them.
import { type AddressAnchorResult, type GeocodeRun, evaluateAddressAnchor } from "./address-anchor.ts";
import { REVIEWED_SOURCES, type ReviewedSource } from "./registry.ts";

export const BULK_INTAKE_VERSION = "bulk-intake.v1";

export interface IntakeRow {
  /** Stable within the batch (e.g. `<ward>:<listing order>`). */
  id: string;
  name: string;
  /** The publisher's address cell verbatim; null when the listing gives none. */
  officialAddress: string | null;
  prefecture: string;
  municipality: string;
  /** What the listing says at checkedAt: only `listed` is current operation. */
  operation: "listed" | "suspended" | "closed" | "unknown";
  /** The first-party page that lists the row. */
  sourceUrl: string;
}

export interface IntakeBatch {
  sourceId: string;
  checkedAt: string;
  rows: readonly IntakeRow[];
}

export type IntakeDecision = "adoptable" | "needsReview" | "rejected";

export interface IntakeRowResult {
  id: string;
  decision: IntakeDecision;
  reasons: string[];
  /** A geocoded official address is never the smoking place's own point. Exact points come only from a publisher. */
  locationPrecision: "areaApproximate" | null;
  anchor: Extract<AddressAnchorResult, { status: "anchor" }> | null;
  /** Rows sharing one anchor point publish as one spot (same-anchor rule); the first row's id names the group. */
  sameAnchorGroup: string | null;
}

export interface IntakeSummary {
  version: typeof BULK_INTAKE_VERSION;
  sourceId: string;
  rows: number;
  decisions: Record<IntakeDecision, number>;
  /** adoptable rows after the same-anchor rule: the number of spots the batch could add. */
  adoptableSpots: number;
  reasons: Record<string, number>;
  results: IntakeRowResult[];
}

/** Source-level checks, applied to every row: rights and publication come only from the reviewed registry. */
function sourceReasons(sourceId: string, sources: readonly ReviewedSource[]): { decision: IntakeDecision; reasons: string[] } | null {
  const source = sources.find((s) => s.sourceId === sourceId);
  // Absent from the registry = not reviewed yet (or refused); never approved by the batch itself.
  if (source === undefined) return { decision: "needsReview", reasons: ["sourceNotReviewed"] };
  if (source.publicationStatus !== "approved") return { decision: "rejected", reasons: ["sourceBlocked"] };
  if (source.kind !== "municipal" && source.kind !== "operator") return { decision: "rejected", reasons: ["notOfficialSource"] };
  return null;
}

export function evaluateIntakeBatch(
  batch: IntakeBatch, geocodes: ReadonlyMap<string, GeocodeRun>, sources: readonly ReviewedSource[] = REVIEWED_SOURCES,
): IntakeSummary {
  const sourceLevel = sourceReasons(batch.sourceId, sources);
  const seenIds = new Set<string>();
  const seenListings = new Map<string, string>();
  const results: IntakeRowResult[] = batch.rows.map((row) => {
    const reasons: string[] = [];
    let decision: IntakeDecision = "adoptable";
    const reject = (why: string) => { reasons.push(why); decision = "rejected"; };
    const review = (why: string) => { reasons.push(why); if (decision === "adoptable") decision = "needsReview"; };

    if (seenIds.has(row.id)) reject("duplicateRowId");
    seenIds.add(row.id);
    const listingKey = `${row.name.normalize("NFKC").replace(/\s+/g, "")}|${(row.officialAddress ?? "").normalize("NFKC").replace(/\s+/g, "")}`;
    if (seenListings.has(listingKey)) reject("duplicateListing");
    else seenListings.set(listingKey, row.id);
    if (!row.sourceUrl.startsWith("https://")) reject("sourceUrlMissing");
    if (row.operation === "suspended" || row.operation === "closed") reject(`operation:${row.operation}`);
    if (row.operation === "unknown") review("operationUnknown");
    if (sourceLevel !== null) for (const r of sourceLevel.reasons) (sourceLevel.decision === "rejected" ? reject : review)(r);

    const hasAddress = (row.officialAddress ?? "").trim() !== "";
    const geocode = geocodes.get(row.id) ?? null;
    const anchor = evaluateAddressAnchor({ officialAddress: row.officialAddress, expectedPrefecture: row.prefecture,
      expectedMunicipality: row.municipality, geocode: hasAddress ? geocode : null });
    if (anchor.status === "reviewPending") for (const r of anchor.reasons) review(`address:${r}`);
    return { id: row.id, decision, reasons, locationPrecision: anchor.status === "anchor" ? "areaApproximate" : null,
      anchor: anchor.status === "anchor" ? anchor : null, sameAnchorGroup: null };
  });

  // Same-anchor rule over the rows that could be adopted: one spot per distinct point.
  const groups = new Map<string, string>();
  for (const r of results) {
    if (r.decision !== "adoptable" || r.anchor === null) continue;
    const key = `${r.anchor.latitude},${r.anchor.longitude}`;
    r.sameAnchorGroup = groups.get(key) ?? r.id;
    if (!groups.has(key)) groups.set(key, r.id);
  }
  const decisions: Record<IntakeDecision, number> = { adoptable: 0, needsReview: 0, rejected: 0 };
  const reasons: Record<string, number> = {};
  for (const r of results) {
    decisions[r.decision]++;
    for (const why of r.reasons) reasons[why] = (reasons[why] ?? 0) + 1;
  }
  return { version: BULK_INTAKE_VERSION, sourceId: batch.sourceId, rows: results.length, decisions,
    adoptableSpots: groups.size, reasons, results };
}
