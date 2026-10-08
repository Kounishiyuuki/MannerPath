// Benchmark-only adapter. Never registered in SOURCE_ADAPTERS or REVIEWED_SOURCES.
// The simulation registry is passed explicitly to the exporter for disposable DBs only.
import assert from 'node:assert/strict';
import type { SourceAdapter } from '../src/pipeline/source-adapter.ts';
import type { PromotionRegistry } from '../src/pipeline/promotion.ts';
import { reviewedTerms } from '../src/reports/terms.ts';
import { syntheticSpots, type Profile, type Distribution } from './scale/corpus.ts';

export const CAPACITY_SOURCE = 'synthetic-capacity-not-production';
export const CAPACITY_NOW = '2026-10-08T00:00:00Z';
export const CAPACITY_ADAPTER: SourceAdapter = {
  registry: { sourceId: CAPACITY_SOURCE, displayName: 'SYNTHETIC TEST ONLY smoking-place corpus', kind: 'municipal',
    publicationStatus: 'blocked', licenseName: 'SYNTHETIC TEST ONLY', licenseUrl: 'https://example.invalid/synthetic',
    attributionText: 'Generated capacity data; NEVER production evidence' },
  parserVersion: 'synthetic-capacity.v1', resolverVersion: 'synthetic-capacity.v1', mappingVersion: 'synthetic-capacity.v1',
  parse(bytes) {
    const rows = JSON.parse(new TextDecoder().decode(bytes));
    assert.ok(Array.isArray(rows));
    for (const row of rows) assert.ok(Array.isArray(row) && row.length === 4 && row.every((v: unknown) => typeof v === 'string'));
    return { header: ['id', 'syntheticSmokingPlace', 'latitude', 'longitude'], rows };
  },
  upstreamRowRef: v => v[0],
  assertResolvable(release) { assert.equal(release.sourceUrl, 'https://example.invalid/synthetic-capacity'); },
  observe(v) {
    return { name: v[1], latitude: Number(v[2]), longitude: Number(v[3]), supportsPaper: 'unknown', supportsHeated: 'unknown',
      openingHours: { status: 'none', raw: null, parsed: null }, lifecycle: 'active',
      classification: { spotType: 'ashtray', spotSubtype: null, accessType: 'unknown', accessDetail: null, hostType: 'unknown', environment: 'unknown' },
      provenance: ['existence','name','location','supportsPaper','supportsHeated','openingHours','lifecycle','spotType'].map(field => ({
        field, columns: field === 'location' ? ['latitude','longitude'] : ['syntheticSmokingPlace'], rule: 'synthetic-capacity-not-production.v1' })),
    };
  },
  attenuate: () => [], attenuationReference: { attestationVersion: 'synthetic-capacity.v1', referenceKind: 'SYNTHETIC',
    referenceUrl: 'https://example.invalid/synthetic-capacity', checkedAt: CAPACITY_NOW },
  crossReleaseValidated: false,
};
export const CAPACITY_REGISTRY: PromotionRegistry = {
  source(id) { assert.equal(id, CAPACITY_SOURCE); return { ...CAPACITY_ADAPTER.registry, publicationStatus: 'approved' }; },
  terms: reviewedTerms,
};
export function capacityBytes(profile: Profile, distribution: Distribution): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([...syntheticSpots(profile, undefined, distribution)].map(s =>
    [String(s.ordinal), `SYNTHETIC smoking-place ${String(s.ordinal).padStart(6, '0')}`, String(s.latitude), String(s.longitude)])));
}
