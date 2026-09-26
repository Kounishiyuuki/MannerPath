// SourceAdapter boundary (ADR-0008). Everything a reviewed source contributes to the pipeline —
// its registry entry, file shape, per-record resolution rules and fail-closed release checks — is
// behind this interface, so ingest/resolve/registry depend on the boundary and never on a source.
//
// Deliberately minimal: it describes what the one implemented source (台東区) needs today. New
// members arrive with the source that needs them, reviewed against ADR-0008, not speculatively.

import type { ReviewedSource } from "./registry.ts";

export type TriState = "yes" | "no" | "unknown";

export type Lifecycle = "active" | "temporarilyClosed" | "removed";

/** Which raw columns, read by which named rule, a normalized field came from. */
export interface FieldProvenance {
  field: string;
  columns: readonly string[];
  rule: string;
}

/**
 * What one raw record states, normalized by the adapter's mapping (ADR-0008 decision 2). Stored in
 * `source_observations`; everything downstream of the adapter reads this, never the raw columns.
 * Unknown stays unknown; nothing here is a default, and nothing here comes from outside the record.
 */
export interface SourceObservation {
  name: string | null;
  latitude: number;
  longitude: number;
  supportsPaper: TriState;
  supportsHeated: TriState;
  openingHours:
    | { status: "parsed"; raw: string; parsed: unknown }
    | { status: "unparsed"; raw: string; parsed: null }
    // The source states no hours at all (a column it does not have, or an empty value it defines as
    // absent). Not the same as unparsed text, and never read as "open".
    | { status: "none"; raw: null; parsed: null };
  /** The source's own claim. The canonical lifecycle may be weaker after attenuation. */
  lifecycle: Lifecycle;
  provenance: readonly FieldProvenance[];
}

export type AttenuationEffect = "hoursUnknown" | "temporarilyClosed" | "withholdFromPublication";

/** A weakening backed by the adapter's attenuation reference; never an edit of provenance. */
export interface FieldAttenuation {
  field: "openingHours" | "lifecycle" | "location";
  effect: AttenuationEffect;
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

/**
 * Whether the source lists every place in its scope (ADR-0008 decisions 1 and 5). Only a `complete`
 * source's disappearance is removal evidence; `partial` is the default and never implies removal.
 */
export type SourceCompleteness = "partial" | "complete";

export interface SourceAdapter {
  /** Reviewed registry entry (docs/SOURCES.md). The adapter's source id is `registry.sourceId`. */
  registry: ReviewedSource;
  /** Stored on every release this adapter parses; resolve dispatches on it. */
  parserVersion: string;
  /** Stored on every spot, provenance and attenuation row this adapter resolves. */
  resolverVersion: string;
  /** Stored on every observation `observe` produces. Changing `observe` means a new version. */
  mappingVersion: string;
  /** Decodes release bytes into header + rows, failing loudly on an unexpected shape. */
  parse(bytes: Uint8Array): { header: string[]; rows: string[][] };
  /** The publisher's own row identifier, or null when the row has none. */
  upstreamRowRef(values: readonly string[]): string | null;
  /**
   * Fail-closed checks run before a release is resolved and before anything is written — e.g. that
   * reviewed per-release decisions were reviewed against exactly this file.
   */
  assertResolvable(release: ReleaseFingerprint, observations: readonly SourceObservation[]): void;
  /** The field mapping: one raw record (values in header order) -> its normalized observation. */
  observe(values: readonly string[]): SourceObservation;
  /** Weakenings the adapter's reviewed attenuation reference applies to one observation. */
  attenuate(observation: SourceObservation): readonly FieldAttenuation[];
  attenuationReference: AttenuationReference;
  /**
   * Whether a later release of this source may be applied by the cross-release matcher
   * (./match.ts). True only once the matcher is validated on two real releases of this source
   * (ADR-0008 decision 3); until then a second release is refused before anything is written.
   */
  crossReleaseValidated: boolean;
  /**
   * Reviewed completeness for the registry entry's scope. Absent means `partial`; `complete` is set
   * only from reviewed publisher evidence that the list is exhaustive, never inferred.
   */
  completeness?: SourceCompleteness;
}

export function sourceCompleteness(adapter: SourceAdapter): SourceCompleteness {
  return adapter.completeness ?? "partial";
}
