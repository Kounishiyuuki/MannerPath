// In-memory bounding-box grid. Exact distances remain the final test; the grid never asserts coverage.
import { haversineMeters } from "../geo/distance.ts";
export class CoverageSpatialIndex<T extends { latitude: number; longitude: number }> {
  private cells = new Map<string, T[]>();
  constructor(points: readonly T[]) {
    for (const point of points) {
      const key = this.key(point.latitude, point.longitude);
      const cell = this.cells.get(key) ?? [];
      cell.push(point); this.cells.set(key, cell);
    }
  }
  private key(latitude: number, longitude: number) { return `${Math.floor(latitude / .02)},${Math.floor(longitude / .02)}`; }
  within(point: { latitude: number; longitude: number }, radius: number): T[] {
    const dy = radius / 110_000;
    const dx = dy / Math.cos((Math.abs(point.latitude) + dy) * Math.PI / 180);
    const result: T[] = [];
    for (let y = Math.floor((point.latitude - dy) / .02); y <= Math.floor((point.latitude + dy) / .02); y++) {
      for (let x = Math.floor((point.longitude - dx) / .02); x <= Math.floor((point.longitude + dx) / .02); x++) {
        for (const p of this.cells.get(`${y},${x}`) ?? []) if (haversineMeters(point, p) <= radius) result.push(p);
      }
    }
    return result;
  }
}
