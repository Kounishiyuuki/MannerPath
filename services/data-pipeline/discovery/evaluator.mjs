/** Discovery classification only. Publication approval has no transition here. */
export function resourceStatus(scan) {
  if (!scan || scan.blockerCodes?.some(code => ['incompatibleFormat', 'payloadTooLarge'].includes(code))) return 'blocked';
  if (scan.matchingRowCount > 0) return 'candidate';
  return scan.rawRowCount != null ? 'rawScanned' : 'blocked';
}

export function targetStatus(resources, blockerCodes) {
  if (resources.some(resource => resource.status === 'candidate')) return 'candidate';
  if (resources.some(resource => resource.status === 'rawScanned')) return 'rawScanned';
  if (resources.length && resources.every(resource => resource.status === 'blocked')) return 'blocked';
  if (blockerCodes.some(code => ['accessBlocked', 'rateLimited', 'rawUnavailable', 'incompatibleFormat', 'payloadTooLarge'].includes(code))) return 'blocked';
  return 'metadataScanned';
}

export function manualReviewTriage(resource = {}, {review = null, reviewedSourceIds = [], targetOnly = false, blockerCodes = []} = {}) {
  const blockers = [...new Set([...blockerCodes, ...(resource.blockerCodes || []), ...(review?.blockerCodes || [])])];
  const gate = review?.approvalGate || {};
  const scoped = !targetOnly && typeof gate.exactDataset === 'string' &&
    gate.exactDataset === resource.rawUrl;
  const present = value => typeof value === 'string' && value.trim().length > 0;
  const rights = scoped && gate.exactApplicableLicense === true &&
    gate.redistributionAllowed === true && gate.derivationAllowed === true &&
    present(resource.licenseMetadata) && present(resource.attributionMetadata) &&
    !blockers.includes('licenseUnknown') ? 'explicit-review-signal' : 'unknown';
  const coordinates = !blockers.some(code => ['coordinatesMissing', 'polygonOnly'].includes(code)) &&
    resource.coordinateAvailability === 'all' ? 'available-signal' : 'unknown';
  const smokingEvidence = blockers.some(code => ['noSmokingEvidence', 'polygonOnly'].includes(code)) || resource.matchingRowCount === 0 ?
    'no-point-evidence' : resource.matchingRowCount > 0 ? 'keyword-signal' : 'unknown';
  let classification = 'MANUAL_REVIEW_REQUIRED', priority = 'P3';
  if (targetOnly && reviewedSourceIds.length) classification = 'ALREADY_IMPLEMENTED';
  else if ([401, 403, 429].includes(resource.fetchStatus) || blockers.some(code => ['accessBlocked', 'rateLimited', 'rawUnavailable'].includes(code))) classification = 'ACCESS_BLOCKED';
  else if (resource.externalReferenceOnly === true || blockers.includes('externalReferenceOnly')) classification = 'EXTERNAL_REFERENCE_ONLY';
  else if (blockers.some(code => ['incompatibleFormat', 'payloadTooLarge'].includes(code))) classification = 'FORMAT_BLOCKED';
  else if (smokingEvidence === 'no-point-evidence') classification = 'NO_SMOKING_POINT_EVIDENCE';
  else if (review?.verdict === 'blocked' || resource.status === 'blocked') classification = 'MANUAL_REVIEW_REQUIRED';
  else if (smokingEvidence === 'keyword-signal') {
    if (rights === 'unknown' && coordinates === 'unknown') {
      classification = 'RIGHTS_AND_COORDINATES_UNKNOWN'; priority = 'P2';
    } else if (rights === 'unknown') {
      classification = 'RIGHTS_UNKNOWN'; priority = 'P1';
    } else if (coordinates === 'unknown') {
      classification = 'COORDINATES_UNKNOWN'; priority = 'P1';
    } else {
      classification = 'READY_FOR_RIGHTS_REVIEW';
      priority = scoped && gate.publisherCoordinates === true && gate.currentOperationEvidence === true &&
        !blockers.length && !resource.truncated ? 'P0' : 'P1';
    }
  }
  return {classification, priority, smokingEvidence, rights, coordinates,
    licenseMetadata: resource.licenseMetadata ?? null, attributionMetadata: resource.attributionMetadata ?? null,
    coordinateColumns: resource.coordinateColumns || [], geometryTypes: resource.geometryTypes || [],
    blockerCodes: blockers, approvalAutomated: false};
}
