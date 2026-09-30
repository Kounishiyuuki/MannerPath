import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {dirname} from 'node:path';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const discoveryStates = new Set(['unscanned', 'metadataScanned', 'rawAvailable', 'rawScanned', 'blocked', 'candidate']);

/** A corrupt checkpoint must never turn an already scanned host into new work. */
export async function loadState(path) {
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return {version: 1, targets: {}, resources: {}};
    throw error;
  }
  const state = JSON.parse(text);
  if (state.version !== 1 || !record(state.targets) || !record(state.resources)) throw new Error('Invalid discovery checkpoint');
  for (const entry of Object.values(state.targets)) {
    if (!record(entry) || !discoveryStates.has(entry.status)) throw new Error('Invalid discovery target state');
  }
  for (const entry of Object.values(state.resources)) {
    if (!record(entry) || ![...discoveryStates, 'priorInspected'].includes(entry.status)) throw new Error('Invalid discovery resource state');
  }
  return state;
}

/** Caller serializes writes; rename prevents a interrupted process from leaving partial JSON. */
export async function saveState(path, state) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path + '.tmp', JSON.stringify(state, null, 2) + '\n');
  await rename(path + '.tmp', path);
}
