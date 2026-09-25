// The reviewed source adapters (ADR-0008). A source that is not listed here cannot be ingested,
// resolved or registered: adding one is a reviewed repository change together with docs/SOURCES.md.
// OSM is deliberately absent until its own ADR (docs/DATA_POLICY.md).

import type { SourceAdapter } from "./source-adapter.ts";
import { TAITO_ADAPTER } from "./taito-adapter.ts";

export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [TAITO_ADAPTER];

const byParserVersion = new Map(SOURCE_ADAPTERS.map((a) => [a.parserVersion, a]));

export function adapterForParserVersion(parserVersion: string): SourceAdapter {
  const adapter = byParserVersion.get(parserVersion);
  if (!adapter) {
    throw new Error(`adapters: no reviewed source adapter parses ${parserVersion} (known: ${[...byParserVersion.keys()].join(", ")})`);
  }
  return adapter;
}
