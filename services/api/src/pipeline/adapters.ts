// The reviewed source adapters (ADR-0008). A source that is not listed here cannot be registered or
// approved (REVIEWED_SOURCES is derived from this list), so nothing it ingests can be published:
// adding one is a reviewed repository change together with docs/SOURCES.md.
// OSM is deliberately absent until its own ADR (docs/DATA_POLICY.md).

import type { SourceAdapter } from "./source-adapter.ts";
import { TAITO_ADAPTER } from "./taito-adapter.ts";

export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [TAITO_ADAPTER];
