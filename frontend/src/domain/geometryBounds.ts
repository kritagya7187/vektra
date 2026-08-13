import type { GeoJsonMultiPolygon } from '../api';
export interface LonLatBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}
function extend(bounds: LonLatBounds, geometry: GeoJsonMultiPolygon): LonLatBounds {
  let { west, south, east, north } = bounds;
  for (const polygonRings of geometry.coordinates) {
    for (const ring of polygonRings) {
      for (const [lon, lat] of ring) {
        west = Math.min(west, lon);
        south = Math.min(south, lat);
        east = Math.max(east, lon);
        north = Math.max(north, lat);
      }
    }
  }
  return { west, south, east, north };
}
export function geometryBounds(geometries: readonly GeoJsonMultiPolygon[]): LonLatBounds | null {
  if (geometries.length === 0) {
    return null;
  }
  let bounds: LonLatBounds = {
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
  };
  for (const geometry of geometries) {
    bounds = extend(bounds, geometry);
  }
  return bounds;
}
