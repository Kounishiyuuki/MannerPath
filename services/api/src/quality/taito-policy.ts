import type { Db } from "../db.ts";
import type { Check } from "./analyze.ts";
import {
  ATTENUATED_FIELD,
  TAITO_LIST_PAGE_ATTESTATION_VERSION,
  TAITO_LIST_PAGE_CHECKED_AT,
  TAITO_LIST_PAGE_CONFLICTS,
  TAITO_LIST_PAGE_REFERENCE_KIND,
  TAITO_LIST_PAGE_URL,
  TAITO_REVIEWED_RELEASE,
} from "../pipeline/taito-list-page.ts";
import { TAITO_EXISTENCE_RULE, TAITO_SOURCE_ID, TAITO_UNRESOLVED_FIELDS } from "../pipeline/taito.ts";

function tally(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a < b ? -1 : 1));
}

export async function analyzeTaitoQuality(db: Db, sourceId: string) {
  // Per-source expectation, not a repository invariant. 台東区's file has no column for a spot's
  // type, host, access or environment (services/api/src/pipeline/taito.ts), so a Taito-derived spot
  // that carries one of them was inferred — in this corpus, from a convenience store's name. A
  // future reviewed source that *states* such a value resolves it with provenance and is untouched
  // by these two checks.
  const { results: taitoSpots } = await db.prepare(
    `SELECT s.spot_id, s.spot_type, s.host_type, s.access_type, s.environment, p.rule AS existence_rule,
            (SELECT group_concat(field) FROM spot_field_provenance q WHERE q.spot_id = s.spot_id
              AND q.field IN ('spotType', 'hostType', 'accessType', 'environment')) AS typed_fields
     FROM spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     WHERE rel.source_id = ?
     ORDER BY s.spot_id`,
  ).bind(sourceId).all<{
    spot_id: string; spot_type: string; host_type: string | null; access_type: string;
    environment: string; existence_rule: string; typed_fields: string | null;
  }>();

  const taitoTyped = taitoSpots.filter((r) =>
    r.spot_type !== "unknown" || r.host_type !== null || r.access_type !== "unknown"
    || r.environment !== "unknown" || r.typed_fields !== null);
  const taitoHostEvidence = taitoSpots.filter((r) => r.existence_rule !== TAITO_EXISTENCE_RULE);

  // Issue #42 reconciliation: every record the ward's *other* current publication contradicts must
  // have ended up conservative — hours that cannot yield a confirmed openNow, or no publication at
  // all — and every weakening must be backed by an explicit attestation row carrying the reference,
  // the check date and the exact release it was reviewed against.
  const { results: reconciled } = await db.prepare(
    `SELECT s.spot_id, s.name, s.opening_hours_status, s.lifecycle, s.publication_hold,
            EXISTS (SELECT 1 FROM tile_snapshot_spots t WHERE t.spot_id = s.spot_id) AS published
     FROM spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     WHERE rel.source_id = ? ORDER BY s.spot_id`,
  ).bind(sourceId).all<{
    spot_id: string; name: string | null; opening_hours_status: string; lifecycle: string;
    publication_hold: string | null; published: number;
  }>();
  const byName = new Map(reconciled.map((r) => [r.name ?? "", r]));

  const { results: attenuations } = await db.prepare(
    `SELECT a.spot_id, s.name, a.field, a.effect, a.attestation_version, a.reference_kind, a.reference_url,
            a.checked_at, a.release_content_sha256, a.release_observed_on, a.release_source_url, a.resolver_version
     FROM spot_field_attenuations a JOIN spots s ON s.spot_id = a.spot_id
     WHERE EXISTS (SELECT 1 FROM spot_field_provenance p JOIN source_records r ON r.record_id = p.record_id
       JOIN source_releases rel ON rel.release_id = r.release_id
       WHERE p.spot_id = a.spot_id AND p.field = 'existence' AND rel.source_id = ?)
     ORDER BY a.spot_id, a.field, a.effect`,
  ).bind(sourceId).all<{
    spot_id: string; name: string | null; field: string; effect: string; attestation_version: string;
    reference_kind: string; reference_url: string; checked_at: string; release_content_sha256: string;
    release_observed_on: string | null; release_source_url: string; resolver_version: string;
  }>();
  const attenuationAt = new Map(attenuations.map((a) => [`${a.spot_id}\u0000${a.effect}`, a]));

  // A database with no Taito spots at all (a fixture of another source) has nothing to check.
  const unresolvedConflicts = reconciled.length === 0 ? [] : TAITO_LIST_PAGE_CONFLICTS.flatMap((c) => {
    const row = byName.get(c.csvName);
    if (!row) return [`${c.csvName}: no canonical spot`];
    const problems: string[] = [];
    if (c.effects.includes("hoursUnknown") && row.opening_hours_status === "parsed") {
      problems.push("hours still parsed");
    }
    if (c.effects.includes("temporarilyClosed") && (row.lifecycle !== "temporarilyClosed" || row.published === 1)) {
      problems.push(`lifecycle ${row.lifecycle}, published ${row.published === 1}`);
    }
    if (c.effects.includes("withholdFromPublication") && (row.publication_hold === null || row.published === 1)) {
      problems.push(`hold ${row.publication_hold ?? "(none)"}, published ${row.published === 1}`);
    }
    // The attenuation row is the evidence. Without it the value is weakened for no recorded reason,
    // which is the failure mode this check exists to catch.
    for (const effect of c.effects) {
      const a = attenuationAt.get(`${row.spot_id}\u0000${effect}`);
      if (!a) { problems.push(`${effect}: no attestation row`); continue; }
      if (a.field !== ATTENUATED_FIELD[effect]) problems.push(`${effect}: attests field ${a.field}`);
      if (a.attestation_version !== TAITO_LIST_PAGE_ATTESTATION_VERSION) problems.push(`${effect}: attestation ${a.attestation_version}`);
      if (a.reference_kind !== TAITO_LIST_PAGE_REFERENCE_KIND || a.reference_url !== TAITO_LIST_PAGE_URL) {
        problems.push(`${effect}: reference ${a.reference_kind} ${a.reference_url}`);
      }
      if (a.checked_at !== TAITO_LIST_PAGE_CHECKED_AT) problems.push(`${effect}: checked_at ${a.checked_at}`);
      if (a.release_content_sha256 !== TAITO_REVIEWED_RELEASE.contentSha256
        || a.release_observed_on !== TAITO_REVIEWED_RELEASE.observedOn
        || a.release_source_url !== TAITO_REVIEWED_RELEASE.sourceUrl) {
        problems.push(`${effect}: attested against another release (${a.release_content_sha256.slice(0, 12)}…, ${a.release_observed_on ?? "(null)"})`);
      }
    }
    return problems.length === 0 ? [] : [`${c.csvName}: ${problems.join("; ")}`];
  });

  // The converse: nothing may be attenuated that the reviewed attestations do not call for.
  const attested = new Set(TAITO_LIST_PAGE_CONFLICTS.flatMap((c) => c.effects.map((e) => `${c.csvName}\u0000${e}`)));
  const unattested = attenuations.filter((a) => !attested.has(`${a.name ?? ""}\u0000${a.effect}`));



  const checks: Check[] = [];
  const check = (id: string, ok: boolean, detail: string) => checks.push({ id, status: ok ? "pass" : "fail", detail });
  check(`${TAITO_SOURCE_ID}-unstated-fields-stay-unknown`, taitoTyped.length === 0,
    taitoTyped.length === 0
      ? `all ${taitoSpots.length} spots derived from ${TAITO_SOURCE_ID} leave ${TAITO_UNRESOLVED_FIELDS.join(", ")} unknown/null with no provenance row, because that source states none of them`
      : `Taito-derived spots carrying a value that source does not state: ${taitoTyped.map((r) => r.spot_id).join(", ")}`);

  check(`${TAITO_SOURCE_ID}-existence-evidence-is-the-municipal-listing`, taitoHostEvidence.length === 0,
    taitoHostEvidence.length === 0
      ? `all ${taitoSpots.length} Taito-derived spots cite ${TAITO_EXISTENCE_RULE} for existence — the ward listing, never the convenience store or venue that hosts the spot`
      : `Taito-derived spots citing another existence rule: ${taitoHostEvidence.map((r) => `${r.spot_id} (${r.existence_rule})`).join(", ")}`);

  check(`${TAITO_SOURCE_ID}-list-page-conflicts-resolved-conservatively`, unresolvedConflicts.length === 0,
    unresolvedConflicts.length === 0
      ? `all ${TAITO_LIST_PAGE_CONFLICTS.length} reviewed contradictions with ${TAITO_LIST_PAGE_URL} are resolved subtractively, and each weakening is backed by a spot_field_attenuations row citing ${TAITO_LIST_PAGE_ATTESTATION_VERSION}, checked ${TAITO_LIST_PAGE_CHECKED_AT}, against the reviewed release ${TAITO_REVIEWED_RELEASE.contentSha256.slice(0, 12)}… observed ${TAITO_REVIEWED_RELEASE.observedOn}`
      : `contradictions not conservatively resolved: ${unresolvedConflicts.join(" | ")}`);

  check(`${TAITO_SOURCE_ID}-attenuations-are-attested`, unattested.length === 0,
    unattested.length === 0
      ? `every attenuation in spot_field_attenuations (${attenuations.length}) is called for by ${TAITO_LIST_PAGE_ATTESTATION_VERSION}`
      : `attenuations with no reviewed attestation: ${unattested.map((a) => `${a.name ?? a.spot_id} (${a.effect})`).join(", ")}`);

  return {
    checks,
    reconciliation: {
      attestationVersion: TAITO_LIST_PAGE_ATTESTATION_VERSION,
      secondPublicationUrl: TAITO_LIST_PAGE_URL,
      checkedAt: TAITO_LIST_PAGE_CHECKED_AT,
      referenceKind: TAITO_LIST_PAGE_REFERENCE_KIND,
      reviewedRelease: TAITO_REVIEWED_RELEASE,
      conflicts: TAITO_LIST_PAGE_CONFLICTS.length,
      effects: tally(TAITO_LIST_PAGE_CONFLICTS.flatMap((c) => [...c.effects])),
      attestedFieldAttenuations: attenuations.length,
      canonicalButWithheld: reconciled.filter((r) => r.published === 0).map((r) => ({
        name: r.name,
        lifecycle: r.lifecycle,
        publicationHold: r.publication_hold,
        effects: attenuations.filter((a) => a.spot_id === r.spot_id).map((a) => a.effect).sort(),
      })),
      unresolved: unresolvedConflicts,
    },
  };
}
