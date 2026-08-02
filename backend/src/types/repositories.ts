import type { Database } from '../database';
import type {
  Building,
  CreateBuildingInput,
  CreateDataProvenanceRecordInput,
  CreateEnvironmentalRasterAssetInput,
  CreateHeatExposureFactorValueInput,
  CreateHeatExposureResultInput,
  CreateMeteorologicalObservationInput,
  CreateScenarioInput,
  CreateScenarioOverrideInput,
  CreateSimulationRunInputDatasetInput,
  CreateSimulationRunInput,
  DataProvenanceRecord,
  DataSource,
  EnvironmentalRasterAsset,
  HeatExposureFactorValue,
  HeatExposureResult,
  MeteorologicalObservation,
  Scenario,
  ScenarioOverride,
  SimulationRun,
  SimulationRunInputDataset,
  UpdateSimulationRunStatusInput,
} from '../models';

/**
 * Pure repository CONTRACTS — no SQL, no `pg` import anywhere in this
 * file. Two generic bases (every resource in Section 21 shares the
 * universal "query X by id" / "list X" pattern) plus a small number of
 * entity-specific additions, each cited to its exact EDD grounding
 * rather than guessed at.
 *
 * Every method accepts an optional trailing `executor?: Database` —
 * added in the Service Layer subsystem to close a real gap: every
 * concrete repository (repositories/*.ts, Repository Layer subsystem)
 * already accepts this parameter to support `Database.withTransaction`,
 * but these contracts never declared it, so a service depending on the
 * INTERFACE (not the concrete class) had no way to pass a transactional
 * executor through — making "services coordinate transactions through
 * repository interfaces" (this subsystem's own requirement) impossible
 * to satisfy without this fix. `Database` is an interface, not a
 * concrete implementation, so depending on it here does not reintroduce
 * what "never concrete database implementations" rules out.
 */

export interface ListOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReadRepository<T, TId = string> {
  findById(id: TId, executor?: Database): Promise<T | null>;
  list(options?: ListOptions, executor?: Database): Promise<readonly T[]>;
}

export interface WriteRepository<T, TCreateInput> {
  create(input: TCreateInput, executor?: Database): Promise<T>;
}

export type DataSourceRepository = ReadRepository<DataSource, string>;

/**
 * DataProvenanceRecordRepository and BuildingRepository below gained
 * WriteRepository in the OSM Ingestion subsystem — the first real
 * caller that needs to write through either. Both were correctly
 * read-only until now: vektra_backend_api (the API's own role) has no
 * INSERT on either table; only vektra_ingestion does
 * (db/migrations/0014). Not a database redesign — the grants already
 * existed, only the TypeScript method was missing.
 */
export interface DataProvenanceRecordRepository
  extends
    ReadRepository<DataProvenanceRecord>,
    WriteRepository<DataProvenanceRecord, CreateDataProvenanceRecordInput> {
  /**
   * Heat Exposure Engine subsystem: Section 17's "explicit version
   * identifier, never latest implicitly" is satisfied by resolving AND
   * recording this value, not by never calling it "latest" at all — see
   * this subsystem's engineering review for the full reasoning. Mirrors
   * SimulationRunRepository.findLatestBaselineRun's existing precedent
   * for naming a "most recent by timestamp" query explicitly rather than
   * leaving it implicit.
   */
  findLatestBySourceCode(
    sourceCode: string,
    executor?: Database,
  ): Promise<DataProvenanceRecord | null>;
}

export interface BuildingRepository
  extends ReadRepository<Building>, WriteRepository<Building, CreateBuildingInput> {
  /**
   * Heat Exposure Engine subsystem: OSM ingestion is a versioned append
   * (Section 27), so building.list() alone returns buildings across
   * EVERY batch ever ingested. A simulation run must operate over
   * exactly the building set belonging to ONE resolved provenance batch
   * — this is the "reconstruct the exact building layer used for a
   * historical simulation" mechanism, used internally by this
   * subsystem's own service, not exposed as a new public endpoint.
   */
  listByProvenanceId(provenanceId: string, executor?: Database): Promise<readonly Building[]>;
}

/**
 * EnvironmentalRasterAssetRepository and MeteorologicalObservationRepository
 * below gained WriteRepository in the Remote Sensing Ingestion subsystem
 * — the same "first real caller that needs to write through it" pattern
 * as BuildingRepository/DataProvenanceRecordRepository in OSM Ingestion.
 * Both grants (vektra_ingestion INSERT on both tables) already existed
 * in db/migrations/0014; only the TypeScript method was missing.
 */
export interface EnvironmentalRasterAssetRepository
  extends
    ReadRepository<EnvironmentalRasterAsset>,
    WriteRepository<EnvironmentalRasterAsset, CreateEnvironmentalRasterAssetInput> {
  /**
   * Phase 3 Milestone 2 (Remote Sensing Foundation) — the raster
   * ingestion subsystem's per-scene provenance model (one
   * DataProvenanceRecord per scene/tile, RasterAssetIngestionService's
   * own docs) means this is always at most one row, mirroring how the
   * Heat Exposure Engine already resolves a single meteorological
   * provenance via findLatestBySourceCode — a real, necessary lookup for
   * the simulation engine to find which downloaded raster file to
   * sample for a given resolved provenance batch, not present until this
   * milestone because nothing needed it before.
   */
  findByProvenanceId(
    provenanceId: string,
    executor?: Database,
  ): Promise<EnvironmentalRasterAsset | null>;
}

export interface MeteorologicalObservationRepository
  extends
    ReadRepository<MeteorologicalObservation>,
    WriteRepository<MeteorologicalObservation, CreateMeteorologicalObservationInput> {
  /**
   * Heat Exposure Engine subsystem: the meteorological_context factor
   * (Section 18's "applied uniformly... across the study area") uses the
   * single most recent reading for one variable within one resolved
   * Open-Meteo batch — no averaging/interpolation, see this subsystem's
   * engineering review.
   */
  findLatestByProvenanceAndVariable(
    provenanceId: string,
    variableName: string,
    executor?: Database,
  ): Promise<MeteorologicalObservation | null>;
}
export interface HeatExposureResultRepository
  extends
    ReadRepository<HeatExposureResult>,
    WriteRepository<HeatExposureResult, CreateHeatExposureResultInput> {
  /**
   * EDD Section 21: "retrieve scenario-vs-baseline comparison results"
   * and "Query Heat Exposure Index results for a given simulation run" —
   * both need every result for one run, not a single result by its own
   * id. Added in the Service Layer subsystem once a real caller
   * (HeatExposureResultService / ScenarioService) needed it — this
   * contract had no entity-specific method at all until now, per the
   * Repository Layer subsystem's own note that only cited, real needs
   * earn an addition here.
   */
  listByRunId(runId: string, executor?: Database): Promise<readonly HeatExposureResult[]>;
}

export interface SimulationRunRepository
  extends ReadRepository<SimulationRun>, WriteRepository<SimulationRun, CreateSimulationRunInput> {
  /**
   * EDD Section 21, verbatim: "Query Heat Exposure Index results for a
   * given simulation run (default: latest baseline run)."
   */
  findLatestBaselineRun(executor?: Database): Promise<SimulationRun | null>;

  /**
   * Heat Exposure Engine subsystem: the ONLY update simulation_run ever
   * permits (fn_guard_simulation_run_update, db/migrations/0008) — the
   * lifecycle columns (status/started_at/completed_at/error_message),
   * never the identity columns fixed at creation.
   */
  updateStatus(
    runId: string,
    input: UpdateSimulationRunStatusInput,
    executor?: Database,
  ): Promise<SimulationRun>;
}

export interface ScenarioRepository
  extends ReadRepository<Scenario>, WriteRepository<Scenario, CreateScenarioInput> {
  /**
   * Scenario Simulation Engine subsystem: the ONE update
   * fn_guard_scenario_update permits — transitioning derived_run_id from
   * NULL to a value exactly once (db/migrations/0010). Matches
   * db/migrations/0014's column-level grant, GRANT UPDATE (derived_run_id)
   * ON scenario TO vektra_simulation only — never a general update.
   */
  updateDerivedRunId(
    scenarioId: string,
    derivedRunId: string,
    executor?: Database,
  ): Promise<Scenario>;
}

export interface ScenarioOverrideRepository extends WriteRepository<
  ScenarioOverride,
  CreateScenarioOverrideInput
> {
  /**
   * EDD Section 15: overlays are "resolved at simulation time" — this
   * requires every override belonging to one scenario, in the order
   * scenario_override.sequence_number preserves.
   */
  listByScenarioId(scenarioId: string, executor?: Database): Promise<readonly ScenarioOverride[]>;
}

export interface HeatExposureFactorValueRepository extends WriteRepository<
  HeatExposureFactorValue,
  CreateHeatExposureFactorValueInput
> {
  /**
   * EDD Section 22: the inspection panel's "Heat Exposure Index
   * breakdown" is the per-factor values for one result.
   */
  listByResultId(
    resultId: string,
    executor?: Database,
  ): Promise<readonly HeatExposureFactorValue[]>;

  /**
   * Every factor row for every result under one simulation run, in a
   * single query — the batch counterpart to listByResultId, added for
   * scene-wide (whole-run) visualization so a caller isn't forced into
   * one HTTP round trip per building.
   */
  listByRunId(runId: string, executor?: Database): Promise<readonly HeatExposureFactorValue[]>;
}

export interface SimulationRunInputDatasetRepository extends WriteRepository<
  SimulationRunInputDataset,
  CreateSimulationRunInputDatasetInput
> {
  /**
   * FR-12 / EDD Section 17: "the exact input dataset versions... used,
   * sufficient to reproduce the run" — every dataset version one run
   * consumed.
   */
  listByRunId(runId: string, executor?: Database): Promise<readonly SimulationRunInputDataset[]>;
}
