import {readFile, writeFile, realpath} from 'node:fs/promises';
import {dirname, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const inside = (root, path) => {
 const rel = relative(root, path);
 return rel === '' || (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel));
};

// Resolve existing ancestors too: an external-looking symlink must not lead into git.
async function physicalPath(path) {
 try { return await realpath(path); }
 catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const parent = dirname(path);
  if (parent === path) throw error;
  return resolve(await physicalPath(parent), relative(parent, path));
 }
}
export async function requireExternalPath(path) {
 if (!path || !isAbsolute(path)) throw Error('Reference input/output requires an absolute external path');
 const root = await realpath(repositoryRoot);
 if (inside(root, await physicalPath(resolve(path)))) throw Error('Reference input/output must stay outside the repository');
 return path;
}

export function eligibleReference(tags) {
 if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return false;
 if (tags.amenity === 'smoking_area') return true;
 // A bare dedicated place is eligible; a host venue's policy is not.
 return tags.smoking === 'dedicated' && !tags.amenity &&
  !['shop', 'office', 'craft', 'tourism', 'leisure', 'waste', 'building', 'highway', 'railway', 'aeroway']
   .some(key => tags[key] !== undefined);
}

/** Local analysis assigns targetIds; they are search hints, never identity or evidence. */
export function buildReferenceQueue(manifest, candidates) {
 if (!Array.isArray(candidates)) throw Error('Reference input requires a candidates array');
 const known = new Map(manifest.targets.map(target => [target.id, target]));
 const selected = new Set();
 let eligibleCount = 0;
 for (const candidate of candidates) {
  if (!eligibleReference(candidate?.tags)) continue;
  eligibleCount++;
  for (const id of Array.isArray(candidate.targetIds) ? candidate.targetIds : []) {
   if (typeof id === 'string' && known.has(id)) selected.add(id);
  }
 }
 // Whitelist only independent official-manifest identifiers. No spread from OSM input.
 const queue = [...selected].sort().map(targetId => {
  const target = known.get(targetId);
  return {targetId, jurisdiction: target.name, publisher: target.publisher,
   prefecture: target.prefecture, roles: target.roles};
 });
 return {eligibleCount, queue};
}

export async function runReferenceLeads({manifest, inputPath, outputPath}) {
 await requireExternalPath(inputPath);
 await requireExternalPath(outputPath);
 const input = JSON.parse(await readFile(inputPath, 'utf8'));
 const {eligibleCount, queue} = buildReferenceQueue(manifest, input.candidates);
 // No raw reference content, count, density, coordinate, name, id, tag, hash or URL is persisted.
 // Exclusive creation also prevents clobbering the extract or an earlier queue.
 await writeFile(outputPath, JSON.stringify({schemaVersion: 'official-review-queue.v1', queue}, null, 2) + '\n', {flag: 'wx'});
 return {eligibleCount, leadGroups: queue.length};
}
