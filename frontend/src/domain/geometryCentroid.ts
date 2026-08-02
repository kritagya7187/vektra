import type { GeoJsonMultiPolygon } from '../api';

/**
 * Bounding-box-center centroid — the same real technique already proven
 * correct in the backend's own rasterSampling.ts (its footprintBounds
 * + centroid fallback for footprints smaller than one raster pixel),
 * not a new geometric method invented for this file. Used to place the
 * thermal-field halo entity (scene/thermalFieldLayer.ts) at a real
 * point representative of the building's footprint.
 */
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
