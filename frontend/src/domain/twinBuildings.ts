import type {
  BuildingGeoJsonProperties,
  GeoJsonFeatureCollection,
  GeoJsonMultiPolygon,
} from '../api';

/**
 * The scene-renderable shape: a building's attributes paired with its
 * footprint geometry, split out of the combined GeoJSON Feature the
 * export endpoint returns (properties + geometry together) since the
 * scene layer consumes them separately (buildingLayer.ts renders the
 * geometry, panels render the properties).
 */
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
      continue; // defensive: building.geom_wgs84 is always MultiPolygon (db/migrations/0005)
    }
    twinBuildings.push({ building: feature.properties, geometry: feature.geometry });
  }
  return twinBuildings;
}
