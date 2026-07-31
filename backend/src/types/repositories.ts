import type {
  Building,
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
 * Pure repository CONTRACTS — no implementation, no SQL, no `pg` import
 * anywhere in this file. Deliberately minimal: two generic bases (every
 * resource in Section 21 shares the universal "query X by id" / "list X"
 * pattern) plus a small number of entity-specific additions, each cited
 * to its exact EDD grounding rather than guessed at. Full repository
 * interface design (filters, sort order, cursor-vs-offset pagination,
 * transactions) is deliberately deferred to the Repository Layer
 * subsystem — these exist to establish the contract-only pattern this
 * subsystem was asked to provide, not to lock in that subsystem's design
 * prematurely.
 */

export interface ListOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReadRepository<T, TId = string> {
  findById(id: TId): Promise<T | null>;
  list(options?: ListOptions): Promise<readonly T[]>;
}

export interface WriteRepository<T, TCreateInput> {
  create(input: TCreateInput): Promise<T>;
}

export type DataSourceRepository = ReadRepository<DataSource, string>;
export type DataProvenanceRecordRepository = ReadRepository<DataProvenanceRecord>;
export type BuildingRepository = ReadRepository<Building>;
export type EnvironmentalRasterAssetRepository = ReadRepository<EnvironmentalRasterAsset>;
export type MeteorologicalObservationRepository = ReadRepository<MeteorologicalObservation>;
export type HeatExposureResultRepository = ReadRepository<HeatExposureResult>;

export interface SimulationRunRepository extends ReadRepository<SimulationRun> {
  /**
   * EDD Section 21, verbatim: "Query Heat Exposure Index results for a
   * given simulation run (default: latest baseline run)."
   */
  findLatestBaselineRun(): Promise<SimulationRun | null>;
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
  listByScenarioId(scenarioId: string): Promise<readonly ScenarioOverride[]>;
}

export interface HeatExposureFactorValueRepository {
  /**
   * EDD Section 22: the inspection panel's "Heat Exposure Index
   * breakdown" is the per-factor values for one result.
   */
  listByResultId(resultId: string): Promise<readonly HeatExposureFactorValue[]>;
}

export interface SimulationRunInputDatasetRepository {
  /**
   * FR-12 / EDD Section 17: "the exact input dataset versions... used,
   * sufficient to reproduce the run" — every dataset version one run
   * consumed.
   */
  listByRunId(runId: string): Promise<readonly SimulationRunInputDataset[]>;
}
