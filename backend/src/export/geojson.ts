import type { GeoJsonMultiPolygon, GeoJsonPoint, GeoJsonPolygon } from '../types/geometry';

type ExportableGeometry = GeoJsonPoint | GeoJsonPolygon | GeoJsonMultiPolygon;

export interface GeoJsonFeature<TProperties> {
  readonly type: 'Feature';
  readonly geometry: ExportableGeometry;
  readonly properties: TProperties;
}

export interface GeoJsonFeatureCollection<TProperties> {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoJsonFeature<TProperties>[];
}

/**
 * The one geometry-serialization function in this codebase's export
 * path — "no duplicated geometry serialization logic." Geometry
 * validity is NOT re-checked here: db/migrations/0005's
 * CHECK (ST_IsValid(geom_wgs84)) already guarantees it at the source,
 * and repositories/BuildingRepository.ts already produces correctly
 * RFC-7946-shaped GeoJSON via ST_AsGeoJSON() (Repository Layer
 * subsystem). Re-validating here would duplicate a guarantee that
 * already exists one layer down, not add a real one.
 */
export function toFeatureCollection<T, TProperties>(
  rows: readonly T[],
  getGeometry: (row: T) => ExportableGeometry,
  getProperties: (row: T) => TProperties,
): GeoJsonFeatureCollection<TProperties> {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature' as const,
      geometry: getGeometry(row),
      properties: getProperties(row),
    })),
  };
}
