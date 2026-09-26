// 台東区 公衆喫煙所 as the first SourceAdapter (ADR-0008). This file only wires the existing Taito
// rules (./taito.ts) and reviewed list-page attestations (./taito-list-page.ts) to the boundary;
// the rules themselves are unchanged.

import { parseCsv } from "./csv.ts";
import type { SourceAdapter } from "./source-adapter.ts";
import {
  TAITO_LIST_PAGE_ATTESTATION_VERSION,
  TAITO_LIST_PAGE_CHECKED_AT,
  TAITO_LIST_PAGE_REFERENCE_KIND,
  TAITO_LIST_PAGE_URL,
  assertListPageConflictsMatch,
  assertReviewedReleaseForAttenuation,
} from "./taito-list-page.ts";
import {
  TAITO_MAPPING_VERSION,
  TAITO_PARSER_VERSION,
  TAITO_REGISTRY,
  TAITO_RESOLVER_VERSION,
  assertTaitoHeader,
  observeTaitoRecord,
  taitoAttenuations,
} from "./taito.ts";

export const TAITO_ADAPTER: SourceAdapter = {
  registry: TAITO_REGISTRY,
  parserVersion: TAITO_PARSER_VERSION,
  resolverVersion: TAITO_RESOLVER_VERSION,
  mappingVersion: TAITO_MAPPING_VERSION,
  parse(bytes) {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    const parsed = parseCsv(text);
    assertTaitoHeader(parsed.header);
    return parsed;
  },
  upstreamRowRef: (values) => (values[0] === "" ? null : values[0]),
  // Both checks fail closed, in this order: the release fingerprint first, because matching record
  // names in a different file prove nothing about that file's hours or locations; then the record
  // names, so a re-review that forgot a renamed record cannot silently drop an effect.
  // An observation's name is 名称 verbatim, or null for an empty 名称, which no attestation names.
  assertResolvable(release, observations) {
    assertReviewedReleaseForAttenuation(release);
    assertListPageConflictsMatch(observations.map((o) => o.name ?? ""));
  },
  observe: observeTaitoRecord,
  attenuate: taitoAttenuations,
  attenuationReference: {
    attestationVersion: TAITO_LIST_PAGE_ATTESTATION_VERSION,
    referenceKind: TAITO_LIST_PAGE_REFERENCE_KIND,
    referenceUrl: TAITO_LIST_PAGE_URL,
    checkedAt: TAITO_LIST_PAGE_CHECKED_AT,
  },
  // Only one real Taito release exists in the repository (20260818), so the matcher has not been
  // validated on two real releases of this source.
  crossReleaseValidated: false,
  // docs/SOURCES.md reviews Taito's license and scope but not that its list is exhaustive for the
  // ward, and DATA_POLICY assumes no source complete; so a Taito disappearance is never removal evidence.
  completeness: "partial",
};
