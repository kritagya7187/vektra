/**
 * Minimal RFC 7946 GeoJSON geometry types — only the three geometry
 * types actually used in db/migrations (Point, Polygon, MultiPolygon).
 * Hand-written rather than pulling in a geojson types package: EDD
 * Section 23 explicitly mandates GeoJSON for geometry-bearing responses
 * ("GeoJSON for geometry-bearing responses... appropriate for
 * CesiumJS/GIS tooling interoperability"), but only these three shapes
 * are needed, and adding a dependency (even a types-only one) for three
 * interfaces isn't justified.
 *
 * These describe the TARGET domain shape once a geometry column has been
 * hydrated (e.g. via ST_AsGeoJSON() and JSON.parse in a query) — not how
 * the raw PostGIS column is produced. That query-level detail belongs to
 * the Repository Layer subsystem; no SQL exists here.
 */

export interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
}

export interface GeoJsonPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

export interface GeoJsonMultiPolygon {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly (readonly [number, number])[])[])[];
}
