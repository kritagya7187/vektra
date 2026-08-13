import type { GeoJsonMultiPolygon } from '../api';
export interface LonLat {
  readonly lon: number;
  readonly lat: number;
}
export function geometryCentroid(geometry: GeoJsonMultiPolygon): LonLat {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const polygonRings of geometry.coordinates) {
    const outerRing = polygonRings[0];
    for (const [lon, lat] of outerRing) {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };
}
