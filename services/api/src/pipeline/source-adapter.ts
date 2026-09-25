// SourceAdapter boundary (ADR-0008). A reviewed source owns parsing and raw-schema mapping; generic
// reconciliation/resolution consumes normalized observations and does not know source column layouts.

import type { ReviewedSource } from "./registry.ts";

export type TriState = "yes" | "no" | "unknown";

export interface NormalizedSourceObservation {
  name: string | null;
  latitude: number;
  longitude: number;
  supportsPaper: TriState;
  supportsHeated: TriState;
  openingHours:
    | { status: "parsed"; raw: string; parsed: unknown }
    | { status: "unparsed"; raw: string; parsed: null };
  lifecycle: "active" | "temporarilyClosed" | "removed";
  publicationHold: string | null;
  provenance: readonly { field: string; columns: readonly string[]; rule: string }[];
  attenuations: readonly { field: string; effect: string }[];
}

export interface ReleaseFingerprint {
  contentSha256: string;
  observedOn: string | null;
  sourceUrl: string;
}

export interface AttenuationReference {
  attestationVersion: string;
  referenceKind: string;
  referenceUrl: string;
  checkedAt: string;
}

export interface SourceAdapter {
  registry: ReviewedSource;
  parserVersion: string;
  mappingVersion: string;
  resolverVersion: string;
  parse(bytes: Uint8Array): { header: string[]; rows: string[][] };
  upstreamRowRef(values: readonly string[]): string | null;
  assertResolvable(release: ReleaseFingerprint, records: readonly string[][]): void;
  mapRecord(values: string[]): NormalizedSourceObservation;
  attenuationReference: AttenuationReference;
}
