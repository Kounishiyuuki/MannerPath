/** Discovery classification only. Publication approval has no transition here. */
export function resourceStatus(scan) {
  if (!scan || scan.blockerCodes?.includes('incompatibleFormat')) return 'blocked';
  if (scan.matchingRowCount > 0) return 'candidate';
  return scan.rawRowCount != null ? 'rawScanned' : 'blocked';
}

export function targetStatus(resources, blockerCodes) {
  if (resources.some(resource => resource.status === 'candidate')) return 'candidate';
  if (resources.some(resource => resource.status === 'rawScanned')) return 'rawScanned';
  if (resources.length && resources.every(resource => resource.status === 'blocked')) return 'blocked';
  if (blockerCodes.some(code => ['accessBlocked', 'rateLimited', 'rawUnavailable', 'incompatibleFormat'].includes(code))) return 'blocked';
  return 'metadataScanned';
}
