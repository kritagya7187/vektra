import type { GeoJsonPolygon } from '../../types/geometry';
import type { BoundingBox } from '../../validators';

/**
 * Extracted from the old shared/stac.ts (Phase 3 Milestone 2 removed
 * that file's STAC-specific parsing once real verification showed
 * Sentinel-2/Landsat aren't actually served from a STAC endpoint on
 * this catalogue — see copernicusDiscovery.ts) — this one small,
 * generic helper had nothing to do with that wrong assumption and is
 * still genuinely needed by every raster client to build
 * EnvironmentalRasterAsset.spatial_extent from a query bbox.
 */
export function bboxToPolygon(bbox: BoundingBox): GeoJsonPolygon {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}
