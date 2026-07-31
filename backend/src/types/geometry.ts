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
 *
 * `crs` is optional and was added after the Repository Layer subsystem's
 * runtime verification against a real database: PostGIS's ST_AsGeoJSON()
 * includes an explicit `{"type":"name","properties":{"name":"EPSG:..."}}`
 * member for any geometry whose SRID isn't 4326 (building.geom_utm43n,
 * SRID 32643, is the one column in this schema where this actually
 * happens) — correct, RFC-7946-aware PostGIS behavior: a GeoJSON geometry
 * with no CRS member is assumed WGS84 per spec, so a non-4326 geometry
 * declaring its real CRS explicitly is the honest thing for PostGIS to
 * do, not a bug. The original version of this file didn't declare this
 * field at all, which was an incomplete type, not an incorrect runtime
 * value — found by actually inspecting real query output, not assumed.
 */

export interface GeoJsonCrs {
  readonly type: 'name';
  readonly properties: {
    readonly name: string;
  };
}

export interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
  readonly crs?: GeoJsonCrs;
}

export interface GeoJsonPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
  readonly crs?: GeoJsonCrs;
}

export interface GeoJsonMultiPolygon {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly (readonly [number, number])[])[])[];
  readonly crs?: GeoJsonCrs;
}
