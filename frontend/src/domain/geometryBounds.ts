import type { GeoJsonMultiPolygon } from '../api';

/**
 * A combined bounding box across many building footprints, for camera
 * fit-to-data (scene/camera.ts) — the multi-geometry counterpart to
 * geometryCentroid.ts's single-geometry centroid, same bbox-scanning
 * technique (no new geometric method).
 */
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

/** Null for an empty list — there is nothing to fit a camera to. */
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
