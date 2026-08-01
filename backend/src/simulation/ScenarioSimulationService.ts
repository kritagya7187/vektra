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
  scenarioOverrideRepository as defaultScenarioOverrideRepository,
  scenarioRepository as defaultScenarioRepository,
  simulationRunInputDatasetRepository as defaultSimulationRunInputDatasetRepository,
  simulationRunRepository as defaultSimulationRunRepository,
} from '../repositories';
import { BaseService } from '../services';
import type { DataProvenanceRecord } from '../models';
import type {
  BuildingRepository,
  DataProvenanceRecordRepository,
  HeatExposureFactorValueRepository,
  HeatExposureResultRepository,
  MeteorologicalObservationRepository,
  ScenarioOverrideRepository,
  ScenarioRepository,
  SimulationRunInputDatasetRepository,
  SimulationRunRepository,
} from '../types';
import {
  DEFAULT_CONFIGURATION_VERSION,
  SIMULATION_ENGINE_CODE_VERSION,
} from './HeatExposureSimulationService';
import type { MeteorologicalReading } from './factors';
import { persistHeatExposureResults } from './persistResults';
import { resolveEffectiveAttributes } from './scenarioOverrides';
import type { ScenarioSimulationInput, ScenarioSimulationSummary } from './types';

const OSM_SOURCE_CODE = 'osm_overpass';
const OPEN_METEO_SOURCE_CODE = 'open_meteo';

export interface ScenarioSimulationServiceDependencies {
  readonly scenarioRepository?: ScenarioRepository;
  readonly scenarioOverrideRepository?: ScenarioOverrideRepository;
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
  // Same discipline as HeatExposureSimulationService — only ever an
  // already-safe AppError message, never a raw driver error/stack trace.
  return isAppError(err) ? err.message : 'Scenario execution failed due to an internal error.';
}

/**
 * Orchestrates one Scenario Simulation Engine execution (EDD Section 11,
 * 19): validate the scenario and its baseline -> reuse the baseline's
 * OWN recorded input dataset versions (never independently resolved,
 * "applies overlay on top of the referenced baseline snapshot") ->
 * resolve ScenarioOverride rows into an in-memory-only attribute map ->
 * create a new SimulationRun (run_type='scenario') -> ONE atomic
 * transaction recording simulation_run_input_dataset, every
 * HeatExposureResult/HeatExposureFactorValue (via the same
 * persistHeatExposureResults() HeatExposureSimulationService uses), AND
 * setting scenario.derived_run_id together -> mark completed/failed.
 *
 * See this subsystem's engineering review for why applying overrides
 * has no numeric effect on today's output: no currently-computable
 * factor (only meteorological_context, applied uniformly) reads any
 * building attribute. The override-resolution mechanism itself is real
 * and independently tested; it is inert downstream today, not missing.
 */
export class ScenarioSimulationService extends BaseService {
  private readonly scenarioRepository: ScenarioRepository;
  private readonly scenarioOverrideRepository: ScenarioOverrideRepository;
  private readonly simulationRunRepository: SimulationRunRepository;
  private readonly simulationRunInputDatasetRepository: SimulationRunInputDatasetRepository;
  private readonly dataProvenanceRecordRepository: DataProvenanceRecordRepository;
  private readonly buildingRepository: BuildingRepository;
  private readonly meteorologicalObservationRepository: MeteorologicalObservationRepository;
  private readonly heatExposureResultRepository: HeatExposureResultRepository;
  private readonly heatExposureFactorValueRepository: HeatExposureFactorValueRepository;
  private readonly database: Database;

  constructor(deps: ScenarioSimulationServiceDependencies = {}) {
    super(
      deps.logger ??
        rootLogger.child({ component: 'simulation', service: 'ScenarioSimulationService' }),
    );
    this.scenarioRepository = deps.scenarioRepository ?? defaultScenarioRepository;
    this.scenarioOverrideRepository =
      deps.scenarioOverrideRepository ?? defaultScenarioOverrideRepository;
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

  async run(input: ScenarioSimulationInput): Promise<ScenarioSimulationSummary> {
    const startedAt = Date.now();
    this.logger.info({ scenarioId: input.scenarioId }, 'scenario execution started');

    const scenario = await this.scenarioRepository.findById(input.scenarioId);
    const found = this.assertFound(scenario, `Scenario '${input.scenarioId}' not found.`);
    if (found.derivedRunId !== null) {
      throw new ValidationError(
        `Scenario '${found.scenarioId}' has already been executed (derived run '${found.derivedRunId}').`,
      );
    }

    const baselineRun = await this.simulationRunRepository.findById(found.baselineRunId);
    const validatedBaseline = this.assertFound(
      baselineRun,
      `Baseline simulation run '${found.baselineRunId}' not found.`,
    );
    if (validatedBaseline.runType !== 'baseline') {
      throw new ValidationError(
        `Simulation run '${validatedBaseline.runId}' is a '${validatedBaseline.runType}' run; a scenario must reference a baseline run.`,
      );
    }
    if (validatedBaseline.status !== 'completed') {
      throw new ValidationError(
        `Baseline simulation run '${validatedBaseline.runId}' has status '${validatedBaseline.status}'; a scenario must reference a completed baseline run.`,
      );
    }

    const { osmProvenance, meteorologicalProvenance } = await this.resolveBaselineInputDatasets(
      validatedBaseline.runId,
    );
    this.logger.info(
      {
        baselineRunId: validatedBaseline.runId,
        osmProvenanceId: osmProvenance.provenanceId,
        meteorologicalProvenanceId: meteorologicalProvenance?.provenanceId ?? null,
      },
      'baseline selected',
    );

    const buildings = await this.buildingRepository.listByProvenanceId(osmProvenance.provenanceId);

    const overrides = await this.scenarioOverrideRepository.listByScenarioId(found.scenarioId);
    const effectiveAttributes = resolveEffectiveAttributes(overrides);
    this.logger.info(
      { overrideCount: overrides.length, buildingsWithOverridesCount: effectiveAttributes.size },
      'overrides applied',
    );

    const meteorologicalReading = await this.resolveMeteorologicalReading(
      input,
      meteorologicalProvenance,
    );

    const runId = await this.createRun(found.baselineRunId);
    await this.simulationRunRepository.updateStatus(runId, {
      status: 'running',
      startedAt: new Date(),
    });

    const inputDatasetProvenanceIds = [
      osmProvenance.provenanceId,
      ...(meteorologicalReading ? [meteorologicalReading.provenanceId] : []),
    ];

    try {
      const resultCount = await this.database.withTransaction(async (tx) => {
        for (const provenanceId of inputDatasetProvenanceIds) {
          await this.simulationRunInputDatasetRepository.create({ runId, provenanceId }, tx);
        }

        const count = await persistHeatExposureResults(
          tx,
          runId,
          buildings,
          meteorologicalReading,
          {
            heatExposureResultRepository: this.heatExposureResultRepository,
            heatExposureFactorValueRepository: this.heatExposureFactorValueRepository,
          },
        );

        await this.scenarioRepository.updateDerivedRunId(found.scenarioId, runId, tx);

        return count;
      });

      await this.simulationRunRepository.updateStatus(runId, {
        status: 'completed',
        completedAt: new Date(),
      });

      const summary: ScenarioSimulationSummary = {
        scenarioId: found.scenarioId,
        runId,
        baselineRunId: found.baselineRunId,
        status: 'completed',
        buildingCount: buildings.length,
        resultCount,
        inputDatasetProvenanceIds,
        overrideCount: overrides.length,
        buildingsWithOverridesCount: effectiveAttributes.size,
        durationMs: Date.now() - startedAt,
      };
      this.logger.info(summary, 'scenario execution completed');
      return summary;
    } catch (err) {
      const errorMessage = safeFailureMessage(err);
      this.logger.error({ scenarioId: found.scenarioId, runId, err }, 'scenario execution failed');
      await this.simulationRunRepository.updateStatus(runId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessage,
      });
      throw err;
    }
  }

  private async createRun(baselineRunId: string): Promise<string> {
    const run = await this.simulationRunRepository.create({
      codeVersion: SIMULATION_ENGINE_CODE_VERSION,
      configurationVersion: DEFAULT_CONFIGURATION_VERSION,
      runType: 'scenario',
      baselineRunId,
    });
    return run.runId;
  }

  /**
   * "Applies overlay on top of the referenced baseline snapshot" (EDD
   * Section 11) — the scenario run reuses EXACTLY the provenance ids the
   * baseline run itself recorded (FR-12's own mechanism), never
   * independently resolved via findLatestBySourceCode. A baseline run
   * always records exactly one osm_overpass input; an open_meteo input
   * is present only if the baseline had a meteorological reading.
   */
  private async resolveBaselineInputDatasets(baselineRunId: string): Promise<{
    readonly osmProvenance: DataProvenanceRecord;
    readonly meteorologicalProvenance: DataProvenanceRecord | null;
  }> {
    const inputDatasets = await this.simulationRunInputDatasetRepository.listByRunId(baselineRunId);
    const provenanceRecords = await Promise.all(
      inputDatasets.map((dataset) =>
        this.dataProvenanceRecordRepository.findById(dataset.provenanceId),
      ),
    );

    let osmProvenance: DataProvenanceRecord | null = null;
    let meteorologicalProvenance: DataProvenanceRecord | null = null;
    for (const record of provenanceRecords) {
      if (record === null) {
        continue;
      }
      if (record.sourceCode === OSM_SOURCE_CODE) {
        osmProvenance = record;
      } else if (record.sourceCode === OPEN_METEO_SOURCE_CODE) {
        meteorologicalProvenance = record;
      }
    }

    if (osmProvenance === null) {
      throw new ValidationError(
        `Baseline simulation run '${baselineRunId}' has no recorded OSM input dataset; cannot execute a scenario against it.`,
      );
    }

    return { osmProvenance, meteorologicalProvenance };
  }

  private async resolveMeteorologicalReading(
    input: ScenarioSimulationInput,
    meteorologicalProvenance: DataProvenanceRecord | null,
  ): Promise<MeteorologicalReading | null> {
    if (input.meteorologicalVariableName === undefined) {
      return null;
    }
    const variableName = input.meteorologicalVariableName.trim();
    if (variableName.length === 0) {
      throw new ValidationError('meteorologicalVariableName must not be empty.');
    }

    if (meteorologicalProvenance === null) {
      this.logger.warn(
        { variableName },
        'baseline run has no recorded Open-Meteo input dataset; meteorological_context will be marked not computable',
      );
      return null;
    }

    const observation =
      await this.meteorologicalObservationRepository.findLatestByProvenanceAndVariable(
        meteorologicalProvenance.provenanceId,
        variableName,
      );
    if (observation === null) {
      this.logger.warn(
        { provenanceId: meteorologicalProvenance.provenanceId, variableName },
        'no observation for the requested variable in the baseline-recorded batch; meteorological_context will be marked not computable',
      );
      return null;
    }

    return { provenanceId: meteorologicalProvenance.provenanceId, observation };
  }
}

export const scenarioSimulationService = new ScenarioSimulationService();
