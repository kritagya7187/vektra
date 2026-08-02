import type {
  BuildingGeoJsonProperties,
  GeoJsonFeatureCollection,
  GeoJsonMultiPolygon,
  HeatExposureFactorValue,
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
 *
 * `factors` (visualization redesign) is the joined building's own
 * factor-value rows (matched via HeatExposureFactorValue.resultId ===
 * result.resultId) — sourced from the batch
 * listHeatExposureFactorsForRun() call, joined here the same way results
 * are joined to geometry: client-side, by an id already present on both
 * sides, no new backend join needed. Empty when the caller didn't fetch
 * factors (e.g. deriveTwinBuildingsForResults' comparison-mode re-join,
 * which only ever needed geometry+result, not factor values).
 */
export interface TwinBuilding {
  readonly building: BuildingGeoJsonProperties;
  readonly geometry: GeoJsonMultiPolygon;
  readonly result: HeatExposureResult;
  readonly factors: readonly HeatExposureFactorValue[];
}

export function joinBuildingsWithResults(
  featureCollection: GeoJsonFeatureCollection<BuildingGeoJsonProperties>,
  results: readonly HeatExposureResult[],
  factors: readonly HeatExposureFactorValue[] = [],
): readonly TwinBuilding[] {
  const resultByBuildingId = new Map(results.map((result) => [result.buildingId, result]));
  const factorsByResultId = new Map<string, HeatExposureFactorValue[]>();
  for (const factor of factors) {
    const existing = factorsByResultId.get(factor.resultId);
    if (existing) {
      existing.push(factor);
    } else {
      factorsByResultId.set(factor.resultId, [factor]);
    }
  }

  const joined: TwinBuilding[] = [];
  for (const feature of featureCollection.features) {
    const result = resultByBuildingId.get(feature.properties.buildingId);
    if (result === undefined) {
      continue; // not part of the active run's building set
    }
    if (feature.geometry.type !== 'MultiPolygon') {
      continue; // defensive: building.geom_wgs84 is always MultiPolygon (db/migrations/0005)
    }
    joined.push({
      building: feature.properties,
      geometry: feature.geometry,
      result,
      factors: factorsByResultId.get(result.resultId) ?? [],
    });
  }
  return joined;
}
