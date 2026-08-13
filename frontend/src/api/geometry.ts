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
export interface GeoJsonFeature<TProperties> {
  readonly type: 'Feature';
  readonly geometry: GeoJsonPoint | GeoJsonPolygon | GeoJsonMultiPolygon;
  readonly properties: TProperties;
}
export interface GeoJsonFeatureCollection<TProperties> {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoJsonFeature<TProperties>[];
}
