import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const references = evidence => [...new Set((evidence || []).map(item => item.reference).filter(Boolean))];

/** Coverage means an existing reviewed publication source, never a discovery result. */
export function buildReport(manifest, state, reviews = []) {
  const targets = manifest.targets.map(target => {
    const scan = state.targets[target.id];
    const reviewedSourceIds = target.reviewedSourceIds || [];
    const candidateUrls = (scan?.resourceUrls || []).filter(url => state.resources[url]?.status === 'candidate');
    const candidatesRejected = candidateUrls.length > 0 && candidateUrls.every(url => reviews.some(review => review.rawUrl === url && review.verdict === 'blocked'));
    const coverage = reviewedSourceIds.length ? 'covered' : !scan ? 'unscanned' :
      candidatesRejected ? 'blocked' : scan.status === 'candidate' ? 'candidate' : scan.status === 'blocked' ? 'blocked' : 'scanned/no source';
    return {
      id: target.id, jurisdiction: target.name, prefecture: target.prefecture, kind: target.kind,
      roles: target.roles, coverage, reviewedSourceIds, discoveryStatus: scan?.status || 'unscanned',
      completedAt: scan?.completedAt || null, priorState: target.seedStatus,
      firstScannedAt: scan?.firstScannedAt || scan?.completedAt || null,
      blockerCodes: scan?.blockerCodes || [], truncated: scan?.truncated || false,
      resourceUrls: scan?.resourceUrls || [], fetches: scan?.fetches || [],
      liveFetches: scan?.liveFetches || scan?.fetches || [],
      priorResearchReferences: references(target.priorResearch),
    };
  });
  const resources = Object.entries(state.resources).map(([url, resource]) => ({
    jurisdiction: resource.jurisdiction || null, prefecture: resource.prefecture || null,
    publisher: resource.publisher || null, datasetTitle: resource.datasetTitle || resource.title || null,
    datasetUrl: resource.datasetUrl || null, rawUrl: url, format: resource.rawFormat || resource.format || null,
    sha256: resource.sha256 || null, inspectionSha256: resource.inspectionSha256 || null,
    rawRowCount: resource.rawRowCount ?? null, matchingRowCount: resource.matchingRowCount ?? null,
    matchingValues: resource.matchingValues || [], categoryInventory: resource.categoryInventory || {},
    coordinateAvailability: resource.coordinateAvailability || 'unknown',
    geometryTypes: resource.geometryTypes || [], possibleCrs: resource.possibleCrs || null,
    licenseMetadata: resource.licenseMetadata || resource.license || null,
    attributionMetadata: resource.attributionMetadata || resource.attribution || null,
    fetchStatus: resource.fetchStatus ?? resource.statusCode ?? null,
    fetchedAt: resource.fetchedAt || null, etag: resource.etag || null, lastModified: resource.lastModified || null,
    scanTimestamp: resource.scanTimestamp || null, status: resource.status,
    blockerCodes: resource.blockerCodes || [], truncated: resource.truncated || false,
    priorResearchReferences: references(resource.priorResearch),
  }));
  const prefectures = manifest.prefectures.map(prefecture => {
    const groups = targets.filter(target => target.prefecture === prefecture);
    const reviewedSourceIds = [...new Set(groups.flatMap(target => target.reviewedSourceIds))];
    const coverage = reviewedSourceIds.length ? 'covered' : groups.some(t => t.coverage === 'candidate') ? 'candidate' :
      groups.some(t => t.coverage === 'blocked') ? 'blocked' : groups.some(t => t.completedAt) ? 'scanned/no source' : 'unscanned';
    return {prefecture, coverage, reviewedSourceIds, trackedGroups: groups.length, scannedGroups: groups.filter(t => t.completedAt).length};
  });
  const scanned = resources.filter(resource => ['rawScanned', 'candidate'].includes(resource.status));
  return {
    version: 1, generatedAt: new Date().toISOString(), approvalAutomated: false,
    scanScope: 'Bounded catalog/index scans, not an exhaustive absence claim. Prior inspections are separately counted.',
    coverageScope: 'Covered means partial reviewed publication data exists; it does not mean jurisdiction completeness.',
    summary: {
      manifestTargets: targets.length, prefecturesTracked: manifest.prefectures.length,
      municipalitiesTracked: targets.filter(t => t.kind === 'municipality').length,
      operatorsTracked: targets.filter(t => t.kind === 'operator').length,
      scannedGroups: targets.filter(t => t.completedAt).length,
      rawScannedResources: scanned.length, uniqueScannedHashes: new Set(scanned.map(r => r.sha256).filter(Boolean)).size,
      priorInspectedResources: resources.filter(r => r.status === 'priorInspected').length,
      blockedGroups: targets.filter(t => t.discoveryStatus === 'blocked').length,
      truncatedGroups: targets.filter(t => t.truncated).length,
      keywordCandidates: resources.filter(r => r.status === 'candidate').length,
      individuallyReviewedCandidates: reviews.length,
      rejectedKeywordCandidates: reviews.filter(r => r.verdict === 'blocked').length,
      newApproved: reviews.filter(r => r.verdict === 'approved').length,
      newImplemented: reviews.filter(r => r.implementedSourceId).length,
      existingReviewedSources: new Set(targets.flatMap(t => t.reviewedSourceIds)).size,
      coveredPrefectures: prefectures.filter(p => p.coverage === 'covered').length,
      coveredCapitals: targets.filter(t => t.roles.includes('prefecturalCapital') && t.coverage === 'covered').length,
      coveredOrdinanceCities: targets.filter(t => t.roles.includes('ordinanceDesignatedCity') && t.coverage === 'covered').length,
      coveredTokyoWards: targets.filter(t => t.roles.includes('tokyoWard') && t.coverage === 'covered').length,
    }, prefectures, targets, resources, reviews,
  };
}

export function markdownReport(report) {
  const rows = (headers, data) => [headers.join(' | '), headers.map(() => '---').join(' | '), ...data.map(row => row.map(value => String(value ?? '').replaceAll('|', '\\|')).join(' | ').trimEnd())].join('\n');
  const lines = ['# Nationwide discovery run', '', report.scanScope, '', report.coverageScope, '',
    rows(['Metric', 'Count'], Object.entries(report.summary)), '', '## Prefectures', '',
    rows(['Prefecture', 'Coverage', 'Scanned / tracked groups', 'Reviewed source IDs'], report.prefectures.map(p => [p.prefecture, p.coverage, `${p.scannedGroups} / ${p.trackedGroups}`, p.reviewedSourceIds.join(', ')]))];
  for (const [role, label] of [['prefecturalCapital', 'Prefectural capitals'], ['ordinanceDesignatedCity', 'Ordinance cities'], ['tokyoWard', 'Tokyo wards'], ['operator', 'Operators']]) {
    lines.push('', `## ${label}`, '', rows(['Target', 'Coverage', 'Discovery', 'Truncated', 'Blocker codes'], report.targets.filter(t => role === 'operator' ? t.kind === role : t.roles.includes(role)).map(t => [t.jurisdiction, t.coverage, t.discoveryStatus, t.truncated, t.blockerCodes.join(', ')])));
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const option = (key, fallback) => args.includes('--' + key) ? args[args.indexOf('--' + key) + 1] : fallback;
  const manifest = JSON.parse(await readFile(option('manifest', resolve(directory, 'manifest.json')), 'utf8'));
  const state = JSON.parse(await readFile(option('state', resolve(directory, '.local/state.json')), 'utf8'));
  const reviewsPath = option('reviews', null);
  const reviews = reviewsPath ? JSON.parse(await readFile(reviewsPath, 'utf8')) : [];
  const report = buildReport(manifest, state, reviews);
  const out = option('out', resolve(directory, '.local/report.json'));
  await mkdir(dirname(out), {recursive: true});
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  await writeFile(out.replace(/\.json$/, '') + '.md', markdownReport(report));
  console.log(JSON.stringify(report.summary));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
