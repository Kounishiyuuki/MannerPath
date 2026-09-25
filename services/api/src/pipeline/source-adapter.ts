// SourceAdapter boundary (ADR-0008). Everything a reviewed source contributes to the pipeline —
// its registry entry, file shape, per-record resolution rules and fail-closed release checks — is
// behind this interface, so ingest/resolve/registry depend on the boundary and never on a source.
//
// Deliberately minimal: it describes what the one implemented source (台東区) needs today. New
// members arrive with the source that needs them, reviewed against ADR-0008, not speculatively.

import type { ReviewedSource } from "./registry.ts";

export type TriState = "yes" | "no" | "unknown";

/** What a source resolves one raw record to. Unknown stays unknown; nothing here is a default. */
export interface ResolvedRecord {
  name: string | null;
  latitude: number;
  longitude: number;
  supportsPaper: TriState;
  supportsHeated: TriState;
  openingHours:
    | { status: "parsed"; raw: string; parsed: unknown }
    | { status: "unparsed"; raw: string; parsed: null };
  lifecycle: "active" | "temporarilyClosed" | "removed";
  /** Non-null withholds the spot from publication without claiming it ceased to exist (ADR-0006). */
  publicationHold: string | null;
  provenance: readonly { field: string; columns: readonly string[]; rule: string }[];
  /** Weakenings backed by the adapter's attenuation reference; never edits of provenance. */
  attenuations: readonly { field: string; effect: string }[];
}

/** Identifies one exact release file, for decisions that were reviewed against that file only. */
export interface ReleaseFingerprint {
  contentSha256: string;
  observedOn: string | null;
  sourceUrl: string;
}

/** The reviewed evidence cited by every attenuation row this adapter produces. */
export interface AttenuationReference {
  attestationVersion: string;
  referenceKind: string;
  referenceUrl: string;
  checkedAt: string;
}

export interface SourceAdapter {
  /** Reviewed registry entry (docs/SOURCES.md). The adapter's source id is `registry.sourceId`. */
  registry: ReviewedSource;
  /** Stored on every release this adapter parses; resolve dispatches on it. */
  parserVersion: string;
  /** Stored on every spot, provenance and attenuation row this adapter resolves. */
  resolverVersion: string;
  /** Decodes release bytes into header + rows, failing loudly on an unexpected shape. */
  parse(bytes: Uint8Array): { header: string[]; rows: string[][] };
  /** The publisher's own row identifier, or null when the row has none. */
  upstreamRowRef(values: readonly string[]): string | null;
  /**
   * Fail-closed checks run before a release is resolved and before anything is written — e.g. that
   * reviewed per-release decisions were reviewed against exactly this file.
   */
  assertResolvable(release: ReleaseFingerprint, records: readonly string[][]): void;
  resolveRecord(values: string[]): ResolvedRecord;
  attenuationReference: AttenuationReference;
}
