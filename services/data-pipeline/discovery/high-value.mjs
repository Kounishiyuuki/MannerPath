// Queue research only. Neither a positive inventory nor a priority grants approval.
export const priorityOverrides = new Set(['ward-chuo', 'national-mlit-indoor', 'pref-hokkaido', 'pref-yamanashi']);
const positiveInventory = /Current direct evidence|Official designated-location|Official designated and assisted|Official page gives smoking places|Current designated smoking sites|Direct official list|Current detailed public smoking|Current specific smoking areas|Official 2-site public smoking|Extensive current station smoking|Current 2026-07-24 direct smoking|3 公衆喫煙所 named|6 park smoking booths|3 喫煙所 as text|Current 2026-07-23 official list/;
export function buildHighValueQueue(manifest, reviews) {
 const prior = new Map(reviews.filter(r => r.targetId).map(r => [r.targetId, r]));
 const items = [];
 for (const target of manifest.targets) {
  if (target.seedStatus === 'implemented' && !priorityOverrides.has(target.id)) continue;
  const evidence = (target.priorResearch || []).filter(r => positiveInventory.test(r.evidence || ''));
  if (!priorityOverrides.has(target.id) && !evidence.length) continue;
  const review = prior.get(target.id), gate = review?.approvalGate || {};
  const chuo = target.id === 'ward-chuo', mlit = target.id === 'national-mlit-indoor';
  items.push({target:target.id, name:target.name, prefecture:target.prefecture, publisher:target.publisher,
   candidateSource:gate.exactDataset || evidence.map(e=>e.evidence).join('\n') || 'Mandatory pending access follow-up; smoking Point eligibility not established',
   smokingEvidenceCount:chuo ? 79 : null,
   evidenceCountSemantics:chuo ? 'Historical 79 smoking-title candidate rows; exact category split must be revalidated, not 79 exact-category rows' : 'unknown; positive inventory does not establish a numeric Point count',
   coordinateStatus:chuo ? 'Historical supplied positions for79 smoking-title candidates; category split must be revalidated' : gate.publisherCoordinates || 'unknown for exact smoking-site Point',
   licenseStatus:gate.exactApplicableLicense || 'unknown for exact candidate resource',
   currentOperationStatus:gate.currentOperationEvidence || 'unknown for a publishable coordinate release',
   rawStatus:chuo ? 'prior inspected CSV' : mlit ? 'registered official raw not acquired' : 'no eligible smoking Point raw inspected',
   blocker:review?.blockerCodes || target.blockerCodes,
   previousResearchRef:[...new Set([...(review ? ['docs/research/nationwide-discovery/2026-10-01-east-deep-reviews.json'] : []), ...evidence.map(e=>e.reference)])],
   priority:chuo ? 'P0' : mlit ? 'P2' : 'P3',
   selectionReason:priorityOverrides.has(target.id) ? 'User-mandated priority follow-up' : 'Explicit named smoking inventory; exact smoking geometry and resource reuse permission unresolved',
   status:'queued', blockerResolved:false});
 }
 return items.sort((a,b)=>a.priority.localeCompare(b.priority)||a.target.localeCompare(b.target));
}
