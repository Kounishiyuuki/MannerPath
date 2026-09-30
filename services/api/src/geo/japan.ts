// Japan's extent, generously (Okinotorishima to Etorofu). A coordinate outside it is an input error for this product,
// whatever else vouches for it: a geocoder result (ADR-0011) or a community pin (ADR-0012).
export const JAPAN_EXTENT = { minLat: 20, maxLat: 46, minLon: 122, maxLon: 154 } as const;

export function withinJapan(latitude: number, longitude: number): boolean {
  return latitude >= JAPAN_EXTENT.minLat && latitude <= JAPAN_EXTENT.maxLat
    && longitude >= JAPAN_EXTENT.minLon && longitude <= JAPAN_EXTENT.maxLon;
}
