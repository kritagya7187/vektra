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

/**
 * Step 20: DTOs mirroring backend/src/floodEngine/types.ts field-for-field
 * (the Node backend's own flood-engine client, Step 19), consumed here
 * through the new /api/flood-simulations proxy routes (Step 20 Part 0b)
 * — a distinct 5-state job-lifecycle system from `SimulationRunStatus`
 * above (the older, unrelated heat-exposure engine's 4-state system),
 * named separately to avoid confusing the two.
 */
export type FloodSimulationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** `[west, south, east, north]` in EPSG:4326 — map-display metadata only, never a scientific parameter. */
export type AoiBoundsWgs84 = readonly [west: number, south: number, east: number, north: number];

export interface SubmitFloodSimulationRequest {
  readonly scenarioId: string;
  readonly elevationPath: string;
  readonly buildingMaskPath: string;
  readonly manningNPath: string;
  readonly infiltrationLossPath: string;
  readonly rainfallRatesPath: string;
  readonly aoiBoundsWgs84?: AoiBoundsWgs84;
}

export interface FloodSimulationSubmitResult {
  readonly runId: string;
  readonly status: FloodSimulationStatus;
}

export interface FloodSimulationRunStatus {
  readonly runId: string;
  readonly scenarioId: string;
  readonly status: FloodSimulationStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly errorMessage: string | null;
  readonly aoiBoundsWgs84: AoiBoundsWgs84 | null;
}

export interface FloodMassLedger {
  readonly rainfallInputM3: number;
  readonly infiltrationLossM3: number;
  readonly boundaryOutflowM3: number;
}

/** Step 14's three real per-cell summary rasters, plus run-level metadata — nothing here is recomputed client-side. */
export interface FloodOutputSummary {
  readonly maxDepthM: readonly (readonly number[])[];
  readonly arrivalTimeMin: readonly (readonly (number | null)[])[];
  readonly durationAboveThresholdMin: readonly (readonly number[])[];
  readonly massLedger: FloodMassLedger;
  readonly stepCount: number;
  readonly simulatedDurationS: number;
}

export type FloodSimulationArtifact = 'max-depth' | 'arrival-time' | 'duration-above-threshold';
