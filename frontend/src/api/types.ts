import type { GeoJsonMultiPolygon, GeoJsonPoint, GeoJsonPolygon } from './geometry';
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
export type FloodSimulationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AoiBoundsWgs84 = readonly [west: number, south: number, east: number, north: number];
/** GDAL affine 6-tuple (a, b, c, d, e, f) for elevationPath's grid. */
export type ElevationTransform = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];
/** Optional overrides for the frozen WCA2D numerical parameters; omitted fields use the solver's own defaults. */
export interface SolverParametersOverride {
  readonly tolDelwlM?: number;
  readonly ignoreWdM?: number;
  readonly alpha?: number;
  readonly timeMindtS?: number;
  readonly timeMaxdtS?: number;
}
export interface TimesteppingParametersOverride {
  readonly infiltrationIntervalS?: number;
}
export interface SubmitFloodSimulationRequest {
  readonly scenarioId: string;
  readonly elevationPath: string;
  readonly buildingMaskPath: string;
  readonly manningNPath: string;
  readonly infiltrationLossPath: string;
  readonly rainfallRatesPath: string;
  readonly aoiBoundsWgs84?: AoiBoundsWgs84;
  readonly elevationTransform?: ElevationTransform;
  readonly elevationCrsEpsg?: number;
  readonly solverParameters?: SolverParametersOverride;
  readonly timesteppingParameters?: TimesteppingParametersOverride;
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
export interface FloodOutputSummary {
  readonly maxDepthM: readonly (readonly number[])[];
  readonly arrivalTimeMin: readonly (readonly (number | null)[])[];
  readonly durationAboveThresholdMin: readonly (readonly number[])[];
  readonly massLedger: FloodMassLedger;
  readonly stepCount: number;
  readonly simulatedDurationS: number;
}
export interface CityRunSummary {
  readonly runId: string;
  readonly createdAt: string | null;
  readonly status: string;
  readonly tileCount: number;
  readonly tilesCompleted: number;
}
export interface CityRunDetail {
  readonly manifest: Record<string, unknown>;
  readonly runSummary: Record<string, unknown> | null;
  readonly runStatus: Record<string, unknown> | null;
}
export type CityRunArtifact =
  'max-depth-geotiff' | 'arrival-time-geotiff' | 'duration-above-threshold-geotiff';
export type CityRunBoundary = Record<string, unknown>;
export interface RainfallDay {
  readonly date: string;
  readonly totalMm: number;
  readonly maxHourlyMm: number;
}
export interface RainfallProvenance {
  readonly sourceProductIdentifier: string;
  readonly license: string;
  readonly retrievedAt: string;
  readonly sourceDisplayName: string;
}
export interface RainfallEventList {
  readonly station: { readonly lon: number; readonly lat: number };
  readonly provenance: RainfallProvenance | null;
  readonly days: readonly RainfallDay[];
}
export interface PrepareRainfallEventResult {
  readonly rainfallRatesPath: string;
  readonly hours: number;
  readonly totalMm: number;
}
export type FloodSimulationArtifact =
  | 'max-depth'
  | 'arrival-time'
  | 'duration-above-threshold'
  | 'max-depth-geotiff'
  | 'arrival-time-geotiff'
  | 'duration-above-threshold-geotiff';
