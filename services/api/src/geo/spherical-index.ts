/** Exact spherical search helpers. Cartesian indexing avoids longitude seams and polar special cases. */
export interface Coordinate { latitude: number; longitude: number }
export const EARTH_RADIUS_METRES = 6371000;
type Point = readonly [number, number, number];
function cartesian(p: Coordinate): Point {
  const latitude = p.latitude * Math.PI / 180, longitude = p.longitude * Math.PI / 180;
  return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
}
const squared = (a: Point, b: Point) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Enumerates only adjacent radius-sized cells, partitioned by source, never all nationwide pairs. */
export function* nearbyCrossSourcePairs<T extends Coordinate & { sourceId: string }>(spots: readonly T[], metres: number): Generator<[number, number]> {
  if (!(metres > 0) || metres > Math.PI * EARTH_RADIUS_METRES) throw new Error("invalid spatial radius");
  // Roundoff margin is only a recall prefilter; the existing haversine rule decides inclusion.
  const width = 2 * Math.sin(metres / (2 * EARTH_RADIUS_METRES)) * (1 + 1e-12);
  const cells = new Map<string, Map<string, number[]>>();
  const key = (x: number, y: number, z: number) => `${x}/${y}/${z}`;
  for (let i = 0; i < spots.length; i++) {
    const p = cartesian(spots[i]);
    const [x, y, z] = p.map((v) => Math.floor(v / width));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const [source, indices] of cells.get(key(x + dx, y + dy, z + dz)) ?? []) {
        if (source === spots[i].sourceId) continue;
        for (const j of indices) yield [j, i];
      }
    }
    const k = key(x, y, z), sources = cells.get(k) ?? new Map<string, number[]>();
    const indices = sources.get(spots[i].sourceId) ?? [];
    indices.push(i); sources.set(spots[i].sourceId, indices); cells.set(k, sources);
  }
}

interface Node { index: number; axis: number; left: Node | null; right: Node | null }
/** Balanced KD tree: exact nearest neighbour under chord distance, monotonic with spherical distance. */
export function nearestSphericalDistances(spots: readonly Coordinate[], earthRadiusMetres = 6371008.8): number[] {
  const points = spots.map(cartesian);
  function build(indices: number[], depth: number): Node | null {
    if (!indices.length) return null;
    const axis = depth % 3;
    indices.sort((a, b) => points[a][axis] - points[b][axis] || a - b);
    const mid = Math.floor(indices.length / 2);
    return { index: indices[mid], axis, left: build(indices.slice(0, mid), depth + 1), right: build(indices.slice(mid + 1), depth + 1) };
  }
  const root = build(points.map((_, i) => i), 0);
  return points.map((point, index) => {
    let best = Infinity;
    function visit(node: Node | null): void {
      if (!node || best === 0) return;
      if (node.index !== index) best = Math.min(best, squared(point, points[node.index]));
      const delta = point[node.axis] - points[node.index][node.axis];
      visit(delta < 0 ? node.left : node.right);
      if (delta * delta < best) visit(delta < 0 ? node.right : node.left);
    }
    visit(root);
    return 2 * earthRadiusMetres * Math.asin(Math.min(1, Math.sqrt(best) / 2));
  });
}
