// ADR-0018 D-A/D-R/D-C, shared: one reviewed first-party facility fact row whose pin is the official address's ABR point
// (areaApproximate / facility). The two #400 adapters are this shape written out; new facility sources use this instead.
// No smoking-place coordinate, opening hours, tobacco support or access is inferred: they stay unknown.
import { attributionCarriesCredit, requiredAttributionForReference } from "./address-anchor.ts";
import { AREA_ANCHOR_POLICY_VERSION, type ReviewedAreaAnchor, anchoredObservation } from "./area-anchor.ts";
import { parseCsv } from "./csv.ts";
import type { ReleaseMetadata } from "./ingest.ts";
import type { SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const FACILITY_FACT_HEADER = ["fact_id", "place_name", "area_name", "area_scope", "zones", "official_address", "host_type", "page_url", "checked_at", "anchor_latitude", "anchor_longitude", "anchor_basis", "anchor_reference"] as const;

export interface ReviewedFacilitySource {
  sourceId: string;
  /** Short id for anchor, parser and rule names. */
  slug: string;
  displayName: string;
  pageUrl: string;
  fixtureFile: string;
  fixtureSha256: string;
  release: ReleaseMetadata;
  /** The one reviewed row, in FACILITY_FACT_HEADER order. */
  values: readonly string[];
  hostType: NonNullable<SourceObservation["classification"]>["hostType"];
  environment: NonNullable<SourceObservation["classification"]>["environment"];
  attributionText: string;
  rightsBasis: NonNullable<SourceAdapter["registry"]["rightsBasis"]>;
  reviewedBy: string;
  reviewedOn: string;
}

export function reviewedFacilityAdapter(c: ReviewedFacilitySource): SourceAdapter {
  const col = (name: (typeof FACILITY_FACT_HEADER)[number]) => FACILITY_FACT_HEADER.indexOf(name);
  if (c.values.length !== FACILITY_FACT_HEADER.length || c.values[col("area_scope")] !== "facility"
    || c.values[col("anchor_basis")] !== "officialAddressGeocode" || c.values[col("page_url")] !== c.pageUrl) {
    throw new Error(`${c.sourceId}: not a facility fact row`);
  }
  // requiredAttribution: the published attribution must carry every credit the anchor's level requires.
  for (const credit of requiredAttributionForReference(c.values[col("anchor_reference")])) {
    if (!attributionCarriesCredit(c.attributionText, credit)) throw new Error(`${c.sourceId}: attribution lacks the anchor credit ${credit}`);
  }
  const row = (values: readonly string[]) => {
    if (JSON.stringify(values) !== JSON.stringify(c.values)) throw new Error(`${c.sourceId}: not the reviewed fact row`);
    return values;
  };
  const areaPoint = (values: readonly string[]) => {
    const v = row(values);
    return { areaName: v[col("area_name")], latitude: Number(v[col("anchor_latitude")]), longitude: Number(v[col("anchor_longitude")]),
      scope: "facility" as const, basis: { basis: "officialAddressGeocode" as const, reference: v[col("anchor_reference")] } };
  };
  const anchorFor = (releaseContentSha256: string): ReviewedAreaAnchor => {
    const p = areaPoint(c.values);
    return { anchorId: `aa_${c.slug.replace(/[^a-z0-9]/g, "")}`, areaName: p.areaName, areaKind: "facility", latitude: p.latitude, longitude: p.longitude,
      originKind: "publisherFacilityPoint", originSourceId: c.sourceId, originReleaseContentSha256: releaseContentSha256,
      originUpstreamRowRef: c.values[0], originReference: `${c.fixtureFile}#${c.values[0]}`,
      reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: c.reviewedBy, reviewedOn: c.reviewedOn,
      areaScope: "facility", anchorBasis: p.basis };
  };
  const observe = (values: readonly string[]): SourceObservation => {
    const v = row(values);
    return anchoredObservation({
      name: v[col("place_name")], supportsPaper: "unknown", supportsHeated: "unknown",
      // Facility hours are not smoking-place hours; non-customer access is not established.
      openingHours: { status: "none", raw: null, parsed: null }, lifecycle: "active",
      provenance: [
        { field: "existence", columns: ["zones", "page_url", "checked_at"], rule: `${c.slug}.pageFact.v1` },
        { field: "lifecycle", columns: ["page_url", "checked_at"], rule: `${c.slug}.listedOnCurrentPage.v1` },
        { field: "name", columns: ["place_name"], rule: `${c.slug}.normalizedName.v1` },
        { field: "hostType", columns: ["host_type"], rule: `${c.slug}.statedHost.v1` },
      ],
      classification: { spotType: "unknown", spotSubtype: null, accessType: "unknown", accessDetail: null, hostType: c.hostType, environment: c.environment },
    }, anchorFor(c.fixtureSha256), ["area_name", "area_scope"]);
  };
  return {
    registry: { sourceId: c.sourceId, displayName: c.displayName, kind: "operator", licenseName: null, licenseUrl: null,
      publicationStatus: "approved", attributionText: c.attributionText, rightsBasis: c.rightsBasis },
    parserVersion: `${c.slug}-page-facts.v1`, mappingVersion: `${c.slug}-page-facts.map.v1`, resolverVersion: `${c.slug}-resolver.v1`,
    parse(bytes) {
      const { header, rows } = parseCsv(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
      if (JSON.stringify(header) !== JSON.stringify(FACILITY_FACT_HEADER) || rows.length !== 1) throw new Error(`${c.sourceId}: unexpected fact sheet`);
      rows.forEach(row);
      return { header, rows };
    },
    upstreamRowRef: values => row(values)[0], includesRecord: () => true, areaPoint,
    areaPointColumns: { name: "area_name", latitude: "anchor_latitude", longitude: "anchor_longitude", reviewedBy: c.reviewedBy, reviewedOn: c.reviewedOn },
    reviewedAnchors: releaseContentSha256 => [anchorFor(releaseContentSha256)], observe,
    assertResolvable(release, observations) {
      if (release.contentSha256 !== c.fixtureSha256 || release.sourceUrl !== c.pageUrl
        || release.observedOn !== c.release.observedOn || observations.length !== 1) throw new Error(`${c.sourceId}: not the reviewed fact sheet`);
    },
    attenuate: () => [],
    attenuationReference: { attestationVersion: `${c.slug}-no-attenuations.v1`, referenceKind: "reviewedSource", referenceUrl: c.pageUrl, checkedAt: c.reviewedOn },
    completeness: "partial", crossReleaseValidated: false,
  };
}
