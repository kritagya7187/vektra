import { randomUUID } from 'node:crypto';
import { superuserPool } from './superuserPool';

/**
 * Disposable, clearly-synthetic verification fixtures — inserted via
 * the superuser pool because vektra_backend_api (the role the
 * application itself connects as) has no write access to most of these
 * tables (db/migrations/0014). Not claimed as real Mumbai data, same as
 * every prior subsystem's manual fixture SQL — just parameterized and
 * reusable across test files.
 */

let buildingCounter = 0;

function squareWkt(offsetIndex: number): string {
  const lon = 72.8 + offsetIndex * 0.001;
  const lat = 18.9 + offsetIndex * 0.001;
  const d = 0.0005;
  const ring = `${lon} ${lat},${lon + d} ${lat},${lon + d} ${lat + d},${lon} ${lat + d},${lon} ${lat}`;
  return `MULTIPOLYGON(((${ring})))`;
}

export interface DataProvenanceRecordFixture {
  readonly provenanceId: string;
  readonly sourceCode: string;
}

export async function createDataProvenanceRecord(
  overrides: Partial<{ sourceCode: string; retrievalTimestamp: Date }> = {},
): Promise<DataProvenanceRecordFixture> {
  const sourceCode = overrides.sourceCode ?? 'osm_overpass';
  const provenanceId = randomUUID();
  await superuserPool.query(
    `INSERT INTO data_provenance_record
       (provenance_id, source_code, source_product_identifier, retrieval_timestamp, license, ingestion_pipeline_version, checksum)
     VALUES ($1, $2, 'test-fixture', $3, 'ODbL', 'v0.0.0-test', 'test-checksum')`,
    [provenanceId, sourceCode, overrides.retrievalTimestamp ?? new Date()],
  );
  return { provenanceId, sourceCode };
}

export interface BuildingFixture {
  readonly buildingId: string;
  readonly provenanceId: string;
  readonly name: string;
}

export async function createBuilding(
  overrides: Partial<{
    provenanceId: string;
    name: string | null;
    heightM: number | null;
    buildingLevels: number | null;
  }> = {},
): Promise<BuildingFixture> {
  const provenanceId = overrides.provenanceId ?? (await createDataProvenanceRecord()).provenanceId;
  const buildingId = randomUUID();
  buildingCounter += 1;
  const name = overrides.name === undefined ? `Test Building ${buildingCounter}` : overrides.name;
  const heightM = overrides.heightM === undefined ? 20 : overrides.heightM;
  const buildingLevels = overrides.buildingLevels === undefined ? 5 : overrides.buildingLevels;

  await superuserPool.query(
    `INSERT INTO building (building_id, osm_id, osm_type, name, height_m, building_levels, geom_wgs84, provenance_id)
     VALUES ($1, $2, 'way', $3, $4, $5, ST_GeomFromText($6, 4326), $7)`,
    [
      buildingId,
      900000 + buildingCounter,
      name,
      heightM,
      buildingLevels,
      squareWkt(buildingCounter),
      provenanceId,
    ],
  );
  return { buildingId, provenanceId, name: name ?? '' };
}

export interface SimulationRunFixture {
  readonly runId: string;
}

export async function createSimulationRun(
  overrides: Partial<{
    runType: 'baseline' | 'scenario';
    status: 'pending' | 'running' | 'completed' | 'failed';
    baselineRunId: string | null;
  }> = {},
): Promise<SimulationRunFixture> {
  const runId = randomUUID();
  const runType = overrides.runType ?? 'baseline';
  const status = overrides.status ?? 'completed';
  const baselineRunId = overrides.baselineRunId ?? null;

  await superuserPool.query(
    `INSERT INTO simulation_run (run_id, code_version, configuration_version, run_type, baseline_run_id, status, started_at, completed_at)
     VALUES ($1, 'v0.0.0-test', 'cfg-test', $2, $3, $4,
             CASE WHEN $4 IN ('completed','failed') THEN now() ELSE NULL END,
             CASE WHEN $4 IN ('completed','failed') THEN now() ELSE NULL END)`,
    [runId, runType, baselineRunId, status],
  );
  return { runId };
}

export interface HeatExposureResultFixture {
  readonly resultId: string;
  readonly runId: string;
  readonly buildingId: string;
}

export async function createHeatExposureResult(
  runId: string,
  buildingId: string,
  indexValue: number | null = 0.5,
): Promise<HeatExposureResultFixture> {
  const resultId = randomUUID();
  await superuserPool.query(
    `INSERT INTO heat_exposure_result (result_id, run_id, building_id, index_value) VALUES ($1, $2, $3, $4)`,
    [resultId, runId, buildingId, indexValue],
  );
  return { resultId, runId, buildingId };
}

export async function createHeatExposureFactorValue(
  resultId: string,
  factorKey = 'morphology_density',
  factorValue: number | null = 10,
): Promise<void> {
  await superuserPool.query(
    `INSERT INTO heat_exposure_factor_value (result_id, factor_key, factor_value, is_computable) VALUES ($1, $2, $3, $4)`,
    [resultId, factorKey, factorValue, factorValue !== null],
  );
}

export interface ScenarioFixture {
  readonly scenarioId: string;
  readonly baselineRunId: string;
}

export async function createScenario(
  baselineRunId: string,
  overrides: Partial<{ name: string; derivedRunId: string | null }> = {},
): Promise<ScenarioFixture> {
  const scenarioId = randomUUID();
  const name = overrides.name ?? 'Test Scenario';
  await superuserPool.query(
    `INSERT INTO scenario (scenario_id, baseline_run_id, derived_run_id, name, description, created_by)
     VALUES ($1, $2, $3, $4, 'fixture scenario', 'test-suite')`,
    [scenarioId, baselineRunId, overrides.derivedRunId ?? null, name],
  );
  return { scenarioId, baselineRunId };
}

export async function createScenarioOverride(
  scenarioId: string,
  buildingId: string,
  sequenceNumber: number,
  attributeName = 'roof_albedo',
  overrideValue = '0.8',
): Promise<void> {
  await superuserPool.query(
    `INSERT INTO scenario_override (scenario_id, building_id, sequence_number, attribute_name, override_value)
     VALUES ($1, $2, $3, $4, $5)`,
    [scenarioId, buildingId, sequenceNumber, attributeName, overrideValue],
  );
}

export interface MeteorologicalObservationFixture {
  readonly metObservationId: string;
  readonly provenanceId: string;
  readonly variableName: string;
  readonly variableValue: number;
}

export async function createMeteorologicalObservation(
  overrides: Partial<{
    provenanceId: string;
    variableName: string;
    variableValue: number;
    observationTimestamp: Date;
  }> = {},
): Promise<MeteorologicalObservationFixture> {
  const provenanceId =
    overrides.provenanceId ??
    (await createDataProvenanceRecord({ sourceCode: 'open_meteo' })).provenanceId;
  const metObservationId = randomUUID();
  const variableName = overrides.variableName ?? 'temperature_2m';
  const variableValue = overrides.variableValue ?? 31.4;
  const observationTimestamp = overrides.observationTimestamp ?? new Date();

  await superuserPool.query(
    `INSERT INTO meteorological_observation
       (met_observation_id, source_code, observation_timestamp, location, variable_name, variable_value, variable_unit, provenance_id)
     VALUES ($1, 'open_meteo', $2, ST_GeomFromText('POINT(72.8317 18.925)', 4326), $3, $4, '°C', $5)`,
    [metObservationId, observationTimestamp, variableName, variableValue, provenanceId],
  );
  return { metObservationId, provenanceId, variableName, variableValue };
}

export interface EnvironmentalRasterAssetFixture {
  readonly rasterAssetId: string;
}

export async function createEnvironmentalRasterAsset(
  overrides: Partial<{ provenanceId: string; sourceCode: string }> = {},
): Promise<EnvironmentalRasterAssetFixture> {
  const provenanceId =
    overrides.provenanceId ??
    (await createDataProvenanceRecord({ sourceCode: overrides.sourceCode ?? 'sentinel2_l2a' }))
      .provenanceId;
  const rasterAssetId = randomUUID();
  await superuserPool.query(
    `INSERT INTO environmental_raster_asset
       (raster_asset_id, source_code, acquisition_date, crs, resolution_m, storage_location, spatial_extent, provenance_id)
     VALUES ($1, $2, '2026-01-15', 'EPSG:4326', 10, 's3://test-bucket/tile.tif',
             ST_GeomFromText('POLYGON((72.8 18.9,72.9 18.9,72.9 19.0,72.8 19.0,72.8 18.9))', 4326), $3)`,
    [rasterAssetId, overrides.sourceCode ?? 'sentinel2_l2a', provenanceId],
  );
  return { rasterAssetId };
}
