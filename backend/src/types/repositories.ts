import type { Database } from '../database';
import type {
  Building,
  CreateBuildingInput,
  CreateDataProvenanceRecordInput,
  CreateScenarioInput,
  CreateScenarioOverrideInput,
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
    WriteRepository<DataProvenanceRecord, CreateDataProvenanceRecordInput> {}

export interface BuildingRepository
  extends ReadRepository<Building>, WriteRepository<Building, CreateBuildingInput> {}

export type EnvironmentalRasterAssetRepository = ReadRepository<EnvironmentalRasterAsset>;
export type MeteorologicalObservationRepository = ReadRepository<MeteorologicalObservation>;
export interface HeatExposureResultRepository extends ReadRepository<HeatExposureResult> {
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

export interface SimulationRunRepository extends ReadRepository<SimulationRun> {
  /**
   * EDD Section 21, verbatim: "Query Heat Exposure Index results for a
   * given simulation run (default: latest baseline run)."
   */
  findLatestBaselineRun(executor?: Database): Promise<SimulationRun | null>;
}

export interface ScenarioRepository
  extends ReadRepository<Scenario>, WriteRepository<Scenario, CreateScenarioInput> {}

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

export interface HeatExposureFactorValueRepository {
  /**
   * EDD Section 22: the inspection panel's "Heat Exposure Index
   * breakdown" is the per-factor values for one result.
   */
  listByResultId(
    resultId: string,
    executor?: Database,
  ): Promise<readonly HeatExposureFactorValue[]>;
}

export interface SimulationRunInputDatasetRepository {
  /**
   * FR-12 / EDD Section 17: "the exact input dataset versions... used,
   * sufficient to reproduce the run" — every dataset version one run
   * consumed.
   */
  listByRunId(runId: string, executor?: Database): Promise<readonly SimulationRunInputDataset[]>;
}
