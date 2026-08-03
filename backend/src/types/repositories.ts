import type { Database } from '../database';
import type {
  Building,
  CreateBuildingInput,
  CreateDataProvenanceRecordInput,
  CreateEnvironmentalRasterAssetInput,
  CreateMeteorologicalObservationInput,
  CreateSimulationRunInputDatasetInput,
  CreateSimulationRunInput,
  DataProvenanceRecord,
  DataSource,
  EnvironmentalRasterAsset,
  MeteorologicalObservation,
  SimulationRun,
  SimulationRunInputDataset,
  UpdateSimulationRunStatusInput,
} from '../models';

/**
 * Pure repository CONTRACTS — no SQL, no `pg` import anywhere in this
 * file. Two generic bases (every resource shares the universal "query X
 * by id" / "list X" pattern) plus a small number of entity-specific
 * additions, each cited to the real need that motivated it rather than
 * guessed at.
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
   * "Explicit version identifier, never latest implicitly" is satisfied
   * by resolving AND recording this value, not by never calling it
   * "latest" at all. Mirrors SimulationRunRepository.findLatestBaselineRun's
   * existing precedent for naming a "most recent by timestamp" query
   * explicitly rather than leaving it implicit.
   */
  findLatestBySourceCode(
    sourceCode: string,
    executor?: Database,
  ): Promise<DataProvenanceRecord | null>;
}

export interface BuildingRepository
  extends ReadRepository<Building>, WriteRepository<Building, CreateBuildingInput> {
  /**
   * OSM ingestion is a versioned append, so building.list() alone
   * returns buildings across EVERY batch ever ingested. A simulation run
   * must operate over exactly the building set belonging to ONE resolved
   * provenance batch — this is the "reconstruct the exact building layer
   * used for a historical simulation" mechanism.
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
   * The raster ingestion subsystem's per-scene provenance model (one
   * DataProvenanceRecord per scene/tile, RasterAssetIngestionService's
   * own docs) means this is always at most one row, mirroring how
   * MeteorologicalObservationRepository resolves a single provenance via
   * findLatestByProvenanceAndVariable — a real, necessary lookup to find
   * which downloaded raster file to sample for a given resolved
   * provenance batch.
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
   * Uses the single most recent reading for one variable within one
   * resolved ingestion batch — no averaging/interpolation.
   */
  findLatestByProvenanceAndVariable(
    provenanceId: string,
    variableName: string,
    executor?: Database,
  ): Promise<MeteorologicalObservation | null>;
}

export interface SimulationRunRepository
  extends ReadRepository<SimulationRun>, WriteRepository<SimulationRun, CreateSimulationRunInput> {
  /** Query results for a given simulation run, defaulting to the latest baseline run. */
  findLatestBaselineRun(executor?: Database): Promise<SimulationRun | null>;

  /**
   * The ONLY update simulation_run ever permits
   * (fn_guard_simulation_run_update, db/migrations/0008) — the lifecycle
   * columns (status/started_at/completed_at/error_message), never the
   * identity columns fixed at creation.
   */
  updateStatus(
    runId: string,
    input: UpdateSimulationRunStatusInput,
    executor?: Database,
  ): Promise<SimulationRun>;
}

export interface SimulationRunInputDatasetRepository extends WriteRepository<
  SimulationRunInputDataset,
  CreateSimulationRunInputDatasetInput
> {
  /**
   * "The exact input dataset versions... used, sufficient to reproduce
   * the run" — every dataset version one run consumed.
   */
  listByRunId(runId: string, executor?: Database): Promise<readonly SimulationRunInputDataset[]>;
}
