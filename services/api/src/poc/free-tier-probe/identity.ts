// The identity row both probe databases must carry (worker.ts refuses every route without it). Not in worker.ts:
// workerd treats every named export of the entry module as an entrypoint.
export const PROBE_IDENTITY = "mannerpath-free-tier-probe.v1";
