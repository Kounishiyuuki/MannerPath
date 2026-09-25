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
  TAITO_HEADER,
  TAITO_PARSER_VERSION,
  TAITO_REGISTRY,
  TAITO_RESOLVER_VERSION,
  assertTaitoHeader,
  resolveTaitoRecord,
} from "./taito.ts";

const NAME_COLUMN = TAITO_HEADER.indexOf("名称");

export const TAITO_ADAPTER: SourceAdapter = {
  registry: TAITO_REGISTRY,
  parserVersion: TAITO_PARSER_VERSION,
  resolverVersion: TAITO_RESOLVER_VERSION,
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
  assertResolvable(release, records) {
    assertReviewedReleaseForAttenuation(release);
    assertListPageConflictsMatch(records.map((values) => values[NAME_COLUMN]));
  },
  resolveRecord: resolveTaitoRecord,
  attenuationReference: {
    attestationVersion: TAITO_LIST_PAGE_ATTESTATION_VERSION,
    referenceKind: TAITO_LIST_PAGE_REFERENCE_KIND,
    referenceUrl: TAITO_LIST_PAGE_URL,
    checkedAt: TAITO_LIST_PAGE_CHECKED_AT,
  },
};
