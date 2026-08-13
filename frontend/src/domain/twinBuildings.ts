import type {
  BuildingGeoJsonProperties,
  GeoJsonFeatureCollection,
  GeoJsonMultiPolygon,
} from '../api';
export interface TwinBuilding {
  readonly building: BuildingGeoJsonProperties;
  readonly geometry: GeoJsonMultiPolygon;
}
export function toTwinBuildings(
  featureCollection: GeoJsonFeatureCollection<BuildingGeoJsonProperties>,
): readonly TwinBuilding[] {
  const twinBuildings: TwinBuilding[] = [];
  for (const feature of featureCollection.features) {
    if (feature.geometry.type !== 'MultiPolygon') {
      continue;
    }
    twinBuildings.push({ building: feature.properties, geometry: feature.geometry });
  }
  return twinBuildings;
}
