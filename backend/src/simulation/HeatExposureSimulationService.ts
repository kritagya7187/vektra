import type { Logger } from 'pino';
import { database as defaultDatabase, type Database } from '../database';
import { isAppError, ValidationError } from '../errors';
import { rootLogger } from '../logging';
import {
  buildingRepository as defaultBuildingRepository,
  dataProvenanceRecordRepository as defaultDataProvenanceRecordRepository,
  heatExposureFactorValueRepository as defaultHeatExposureFactorValueRepository,
  heatExposureResultRepository as defaultHeatExposureResultRepository,
  meteorologicalObservationRepository as defaultMeteorologicalObservationRepository,
  simulationRunInputDatasetRepository as defaultSimulationRunInputDatasetRepository,
  simulationRunRepository as defaultSimulationRunRepository,
} from '../repositories';
import { BaseService } from '../services';
import type { Building, DataProvenanceRecord, MeteorologicalObservation } from '../models';
import type {
  BuildingRepository,
  DataProvenanceRecordRepository,
  HeatExposureFactorValueRepository,
  HeatExposureResultRepository,
  MeteorologicalObservationRepository,
  SimulationRunInputDatasetRepository,
  SimulationRunRepository,
} from '../types';
import { FACTOR_KEYS } from '../types';
import { computeFactor, type MeteorologicalReading } from './factors';
import type { HeatExposureSimulationInput, HeatExposureSimulationSummary } from './types';

/**
 * Bumped when THIS engine's factor-computation/version-resolution logic
 * changes — independent of backend/package.json's own version, same
 * convention as INGESTION_PIPELINE_VERSION in both ingestion subsystems
 * (Section 27: a run's code_version identifies the code that produced
 * it, not the deploying service).
 */
const SIMULATION_ENGINE_CODE_VERSION = '1.0.0';

/**
 * No configurable simulation parameters exist yet beyond the caller's
 * own inputs (which variable/which provenance batch) — there is no rich
 * "configuration object" to version. This constant is the honest
 * placeholder until one exists; a caller may still override it per run.
 */
const DEFAULT_CONFIGURATION_VERSION = '1.0.0';

const OSM_SOURCE_CODE = 'osm_overpass';
const OPEN_METEO_SOURCE_CODE = 'open_meteo';

/** Resolved meteorological input, kept alongside its full DataProvenanceRecord (not just the id) for logging. */
interface ResolvedMeteorologicalInput {
  readonly provenance: DataProvenanceRecord;
  readonly observation: MeteorologicalObservation;
}

export interface HeatExposureSimulationServiceDependencies {
  readonly simulationRunRepository?: SimulationRunRepository;
  readonly simulationRunInputDatasetRepository?: SimulationRunInputDatasetRepository;
  readonly dataProvenanceRecordRepository?: DataProvenanceRecordRepository;
  readonly buildingRepository?: BuildingRepository;
  readonly meteorologicalObservationRepository?: MeteorologicalObservationRepository;
  readonly heatExposureResultRepository?: HeatExposureResultRepository;
  readonly heatExposureFactorValueRepository?: HeatExposureFactorValueRepository;
  readonly database?: Database;
  readonly logger?: Logger;
}

function safeFailureMessage(err: unknown): string {
  // Only ever an already-safe AppError message — never a raw driver
  // error or stack trace, matching "never expose internal implementation
  // details" (this subsystem's own brief) and the same discipline used
  // throughout ingestion's savepointBatch.ts.
  return isAppError(err) ? err.message : 'Simulation run failed due to an internal error.';
}

function toFactorReading(
  resolved: ResolvedMeteorologicalInput | null,
): MeteorologicalReading | null {
  return resolved
    ? { provenanceId: resolved.provenance.provenanceId, observation: resolved.observation }
    : null;
}

/**
 * Orchestrates one baseline Heat Exposure Engine run (EDD Section 17):
 * resolve input dataset versions -> create SimulationRun (pending) ->
 * mark running -> one Database.withTransaction() recording
 * simulation_run_input_dataset and, per building, a HeatExposureResult
 * plus its 5 HeatExposureFactorValue rows -> mark completed/failed.
 *
 * Deliberately does NOT implement scenario-run execution (resolving
 * ScenarioOverrides, setting scenario.derived_run_id) — Section 19's
 * Scenario Engine is a distinct subsystem from Section 17's Simulation
 * Engine and is not named in this subsystem's execution flow; see the
 * engineering review's deferred-decisions section.
 */
export class HeatExposureSimulationService extends BaseService {
  private readonly simulationRunRepository: SimulationRunRepository;
  private readonly simulationRunInputDatasetRepository: SimulationRunInputDatasetRepository;
  private readonly dataProvenanceRecordRepository: DataProvenanceRecordRepository;
  private readonly buildingRepository: BuildingRepository;
  private readonly meteorologicalObservationRepository: MeteorologicalObservationRepository;
  private readonly heatExposureResultRepository: HeatExposureResultRepository;
  private readonly heatExposureFactorValueRepository: HeatExposureFactorValueRepository;
  private readonly database: Database;

  constructor(deps: HeatExposureSimulationServiceDependencies = {}) {
    super(
      deps.logger ??
        rootLogger.child({ component: 'simulation', service: 'HeatExposureSimulationService' }),
    );
    this.simulationRunRepository = deps.simulationRunRepository ?? defaultSimulationRunRepository;
    this.simulationRunInputDatasetRepository =
      deps.simulationRunInputDatasetRepository ?? defaultSimulationRunInputDatasetRepository;
    this.dataProvenanceRecordRepository =
      deps.dataProvenanceRecordRepository ?? defaultDataProvenanceRecordRepository;
    this.buildingRepository = deps.buildingRepository ?? defaultBuildingRepository;
    this.meteorologicalObservationRepository =
      deps.meteorologicalObservationRepository ?? defaultMeteorologicalObservationRepository;
    this.heatExposureResultRepository =
      deps.heatExposureResultRepository ?? defaultHeatExposureResultRepository;
    this.heatExposureFactorValueRepository =
      deps.heatExposureFactorValueRepository ?? defaultHeatExposureFactorValueRepository;
    this.database = deps.database ?? defaultDatabase;
  }

  async run(input: HeatExposureSimulationInput = {}): Promise<HeatExposureSimulationSummary> {
    const startedAt = Date.now();
    this.logger.info({ input }, 'simulation started');

    const osmProvenance = await this.resolveProvenance(OSM_SOURCE_CODE, input.osmProvenanceId);
    if (osmProvenance === null) {
      throw new ValidationError(
        'No OSM building data has been ingested; cannot run a simulation without a building batch.',
      );
    }
    const buildings = await this.buildingRepository.listByProvenanceId(osmProvenance.provenanceId);

    const meteorologicalInput = await this.resolveMeteorologicalReading(input);
    const meteorologicalReading = toFactorReading(meteorologicalInput);

    const runId = await this.createRun(input.configurationVersion);
    this.logger.info(
      {
        runId,
        osmProvenanceId: osmProvenance.provenanceId,
        meteorologicalProvenanceId: meteorologicalInput?.provenance.provenanceId ?? null,
        buildingCount: buildings.length,
      },
      'input datasets resolved',
    );

    await this.simulationRunRepository.updateStatus(runId, {
      status: 'running',
      startedAt: new Date(),
    });

    const inputDatasetProvenanceIds = [
      osmProvenance.provenanceId,
      ...(meteorologicalInput ? [meteorologicalInput.provenance.provenanceId] : []),
    ];

    try {
      const resultCount = await this.database.withTransaction(async (tx) => {
        for (const provenanceId of inputDatasetProvenanceIds) {
          await this.simulationRunInputDatasetRepository.create({ runId, provenanceId }, tx);
        }

        for (const building of buildings) {
          await this.computeAndPersistBuildingResult(runId, building, meteorologicalReading, tx);
        }

        return buildings.length;
      });

      await this.simulationRunRepository.updateStatus(runId, {
        status: 'completed',
        completedAt: new Date(),
      });

      const summary: HeatExposureSimulationSummary = {
        runId,
        status: 'completed',
        buildingCount: buildings.length,
        resultCount,
        inputDatasetProvenanceIds,
        durationMs: Date.now() - startedAt,
      };
      this.logger.info(summary, 'simulation completed');
      return summary;
    } catch (err) {
      const errorMessage = safeFailureMessage(err);
      this.logger.error({ runId, err }, 'simulation failed');
      await this.simulationRunRepository.updateStatus(runId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessage,
      });
      throw err;
    }
  }

  private async createRun(configurationVersion?: string): Promise<string> {
    const run = await this.simulationRunRepository.create({
      codeVersion: SIMULATION_ENGINE_CODE_VERSION,
      configurationVersion: configurationVersion ?? DEFAULT_CONFIGURATION_VERSION,
      runType: 'baseline',
    });
    return run.runId;
  }

  private async resolveProvenance(
    sourceCode: string,
    explicitProvenanceId: string | undefined,
  ): Promise<DataProvenanceRecord | null> {
    if (explicitProvenanceId !== undefined) {
      const record = await this.dataProvenanceRecordRepository.findById(explicitProvenanceId);
      if (record === null) {
        throw new ValidationError(`Provenance record '${explicitProvenanceId}' not found.`);
      }
      if (record.sourceCode !== sourceCode) {
        throw new ValidationError(
          `Provenance record '${explicitProvenanceId}' is source '${record.sourceCode}', expected '${sourceCode}'.`,
        );
      }
      return record;
    }
    return this.dataProvenanceRecordRepository.findLatestBySourceCode(sourceCode);
  }

  private async resolveMeteorologicalReading(
    input: HeatExposureSimulationInput,
  ): Promise<ResolvedMeteorologicalInput | null> {
    if (input.meteorologicalVariableName === undefined) {
      return null;
    }
    const variableName = input.meteorologicalVariableName.trim();
    if (variableName.length === 0) {
      throw new ValidationError('meteorologicalVariableName must not be empty.');
    }

    const provenance = await this.resolveProvenance(
      OPEN_METEO_SOURCE_CODE,
      input.meteorologicalProvenanceId,
    );
    if (provenance === null) {
      this.logger.warn(
        { variableName },
        'no open_meteo data has been ingested; meteorological_context will be marked not computable',
      );
      return null;
    }

    const observation =
      await this.meteorologicalObservationRepository.findLatestByProvenanceAndVariable(
        provenance.provenanceId,
        variableName,
      );
    if (observation === null) {
      this.logger.warn(
        { provenanceId: provenance.provenanceId, variableName },
        'no observation for the requested variable in the resolved batch; meteorological_context will be marked not computable',
      );
      return null;
    }

    return { provenance, observation };
  }

  private async computeAndPersistBuildingResult(
    runId: string,
    building: Building,
    meteorologicalReading: MeteorologicalReading | null,
    tx: Database,
  ): Promise<void> {
    const result = await this.heatExposureResultRepository.create(
      { runId, buildingId: building.buildingId },
      tx,
    );

    for (const factorKey of FACTOR_KEYS) {
      const computation = computeFactor(factorKey, meteorologicalReading);
      await this.heatExposureFactorValueRepository.create(
        {
          resultId: result.resultId,
          factorKey,
          factorValue: computation.factorValue,
          isComputable: computation.isComputable,
          notes: computation.notes,
        },
        tx,
      );
    }
  }
}

export const heatExposureSimulationService = new HeatExposureSimulationService();
