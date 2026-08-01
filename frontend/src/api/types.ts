import type { GeoJsonMultiPolygon, GeoJsonPoint, GeoJsonPolygon } from './geometry';

/**
 * DTO shapes mirroring backend/src/models/*.ts and backend/src/types/
 * enums.ts exactly (field names, nullability, closed value sets) —
 * these describe what actually arrives over the wire, not an aspiration.
 * Timestamp fields are `string` (ISO 8601), not `Date`: JSON has no date
 * type, and Express's res.json() serializes every Date via its own
 * toJSON() into an ISO string — parsing to a real Date happens only at
 * the point of display (src/utils/formatting.ts), not in these DTOs.
 */

export type OsmType = 'way' | 'relation';
export type RunType = 'baseline' | 'scenario';
export type SimulationRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type FactorKey =
  | 'thermal_signature'
  | 'vegetation_land_cover'
  | 'morphology_density'
  | 'exposure_shading'
  | 'meteorological_context';

export interface DataSource {
  readonly sourceCode: string;
  readonly displayName: string;
  readonly license: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DataProvenanceRecord {
  readonly provenanceId: string;
  readonly sourceCode: string;
  readonly sourceProductIdentifier: string;
  readonly retrievalTimestamp: string;
  readonly license: string;
  readonly ingestionPipelineVersion: string;
  readonly checksum: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Building {
  readonly buildingId: string;
  readonly osmId: number;
  readonly osmType: OsmType;
  readonly buildingTagType: string | null;
  readonly name: string | null;
  readonly heightM: number | null;
  readonly buildingLevels: number | null;
  readonly geomWgs84: GeoJsonMultiPolygon;
  readonly geomUtm43n: GeoJsonMultiPolygon | null;
  readonly footprintAreaSqm: number | null;
  readonly provenanceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The properties payload of a /buildings/export?format=geojson Feature — Building minus its two geometry fields (they become the Feature's own geometry). */
export type BuildingGeoJsonProperties = Omit<Building, 'geomWgs84' | 'geomUtm43n'>;

export interface SimulationRun {
  readonly runId: string;
  readonly codeVersion: string;
  readonly configurationVersion: string;
  readonly runType: RunType;
  readonly baselineRunId: string | null;
  readonly status: SimulationRunStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HeatExposureResult {
  readonly resultId: string;
  readonly runId: string;
  readonly buildingId: string;
  readonly indexValue: number | null;
  readonly computedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HeatExposureFactorValue {
  readonly factorValueId: string;
  readonly resultId: string;
  readonly factorKey: FactorKey;
  readonly factorValue: number | null;
  readonly isComputable: boolean;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Scenario {
  readonly scenarioId: string;
  readonly baselineRunId: string;
  readonly derivedRunId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScenarioOverride {
  readonly overrideId: string;
  readonly scenarioId: string;
  readonly buildingId: string;
  readonly sequenceNumber: number;
  readonly attributeName: string;
  readonly overrideValue: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** POST /scenarios response body's `data` — the one place ScenarioOverride rows are ever returned (see engineering review's API gap notes). */
export interface ScenarioWithOverrides {
  readonly scenario: Scenario;
  readonly overrides: readonly ScenarioOverride[];
}

/** GET /scenarios/:id/comparison response body's `data`. scenarioResults is null when Scenario.derivedRunId is null — not an error state. */
export interface ScenarioComparison {
  readonly scenario: Scenario;
  readonly baselineResults: readonly HeatExposureResult[];
  readonly scenarioResults: readonly HeatExposureResult[] | null;
}

export interface EnvironmentalRasterAsset {
  readonly rasterAssetId: string;
  readonly sourceCode: string;
  readonly acquisitionDate: string;
  readonly crs: string;
  readonly resolutionM: number;
  readonly storageLocation: string;
  readonly spatialExtent: GeoJsonPolygon;
  readonly provenanceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MeteorologicalObservation {
  readonly metObservationId: string;
  readonly sourceCode: string;
  readonly observationTimestamp: string;
  readonly location: GeoJsonPoint;
  readonly variableName: string;
  readonly variableValue: number;
  readonly variableUnit: string;
  readonly provenanceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateScenarioOverrideRequest {
  readonly buildingId: string;
  readonly attributeName: string;
  readonly overrideValue: string;
}

export interface CreateScenarioRequest {
  readonly baselineRunId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly createdBy?: string | null;
  readonly overrides: readonly CreateScenarioOverrideRequest[];
}
