import type {
  BuildingGeoJsonProperties,
  GeoJsonFeatureCollection,
  GeoJsonMultiPolygon,
  HeatExposureResult,
} from '../api';

/**
 * The design review §7 resolution to a real backend gap: GET /buildings
 * (and its export) is not scoped to any provenance batch, so it returns
 * every building ever ingested across every OSM re-ingestion run.
 * GET /heat-exposure-results?runId= IS scoped to exactly one run, and its
 * building-id set is therefore the authoritative "current building set"
 * for that run. This joins the two client-side, using only the two
 * existing endpoints — no new backend capability is assumed.
 */
export interface TwinBuilding {
  readonly building: BuildingGeoJsonProperties;
  readonly geometry: GeoJsonMultiPolygon;
  readonly result: HeatExposureResult;
}

export function joinBuildingsWithResults(
  featureCollection: GeoJsonFeatureCollection<BuildingGeoJsonProperties>,
  results: readonly HeatExposureResult[],
): readonly TwinBuilding[] {
  const resultByBuildingId = new Map(results.map((result) => [result.buildingId, result]));

  const joined: TwinBuilding[] = [];
  for (const feature of featureCollection.features) {
    const result = resultByBuildingId.get(feature.properties.buildingId);
    if (result === undefined) {
      continue; // not part of the active run's building set
    }
    if (feature.geometry.type !== 'MultiPolygon') {
      continue; // defensive: building.geom_wgs84 is always MultiPolygon (db/migrations/0005)
    }
    joined.push({ building: feature.properties, geometry: feature.geometry, result });
  }
  return joined;
}
