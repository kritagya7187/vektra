import type { Logger } from 'pino';
import { database as defaultDatabase, type Database } from '../database';
import {
  buildingRepository as defaultBuildingRepository,
  heatExposureResultRepository as defaultHeatExposureResultRepository,
  scenarioOverrideRepository as defaultScenarioOverrideRepository,
  scenarioRepository as defaultScenarioRepository,
  simulationRunRepository as defaultSimulationRunRepository,
} from '../repositories';
import type { HeatExposureResult, Scenario, ScenarioOverride, SimulationRun } from '../models';
import type {
  BuildingRepository,
  HeatExposureResultRepository,
  ListOptions,
  ScenarioOverrideRepository,
  ScenarioRepository,
  SimulationRunRepository,
} from '../types';
import { NotFoundError, ValidationError } from '../errors';
import { rootLogger } from '../logging';
import { BaseService } from './BaseService';

export interface CreateScenarioOverrideItem {
  readonly buildingId: string;
  readonly attributeName: string;
  readonly overrideValue: string;
}

/**
 * Service-layer orchestration input, distinct from models/Scenario.ts's
 * CreateScenarioInput (which mirrors the `scenario` table's own columns
 * only). FR-8 describes scenario definition as a single act producing
 * "a set of attribute overrides" — so this input carries the full set
 * up front, rather than a bare scenario the caller would populate via
 * separate calls afterward (a pattern deliberately not built, see
 * class-level notes).
 */
export interface CreateScenarioWithOverridesInput {
  readonly baselineRunId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly createdBy?: string | null;
  readonly overrides: readonly CreateScenarioOverrideItem[];
}

export interface ScenarioWithOverrides {
  readonly scenario: Scenario;
  readonly overrides: readonly ScenarioOverride[];
}

export interface ScenarioComparison {
  readonly scenario: Scenario;
  readonly baselineResults: readonly HeatExposureResult[];
  /** null when the scenario has not yet been executed (derivedRunId is null) — not an error state. */
  readonly scenarioResults: readonly HeatExposureResult[] | null;
}

export interface ScenarioServiceDependencies {
  readonly scenarioRepository?: ScenarioRepository;
  readonly scenarioOverrideRepository?: ScenarioOverrideRepository;
  readonly simulationRunRepository?: SimulationRunRepository;
  readonly buildingRepository?: BuildingRepository;
  readonly heatExposureResultRepository?: HeatExposureResultRepository;
  readonly database?: Database;
  readonly logger?: Logger;
}

/**
 * scenario / scenario_override (EDD FR-8, FR-9, Section 16, 19). The
 * one write path in this backend (db/migrations/0014: vektra_backend_api
 * has INSERT, but never UPDATE, on either table) and the only place
 * this subsystem has real, EDD-grounded business rules to enforce.
 *
 * `createScenario` validates, in order, before writing anything:
 *  1. At least one override is present — FR-8's own phrasing, "a SET
 *     of attribute overrides applied"; zero overrides overrides
 *     nothing.
 *  2. No duplicate (buildingId, attributeName) pair within the request
 *     — conflict detection, checked in-memory against the caller's own
 *     input before any DB round trip.
 *  3. The referenced baseline run exists (NotFoundError).
 *  4. It is actually `runType === 'baseline'` (ValidationError) — this
 *     closes a gap flagged in the earlier database architectural
 *     review (Critical Issue C1): no CHECK constraint can express "this
 *     FK must point at a row where run_type = 'baseline'"; that can
 *     only be validated by reading the row, which a DB trigger could
 *     do but this subsystem cannot add (no migrations), so it is
 *     enforced here instead.
 *  5. It has `status === 'completed'` (ValidationError) — an inference,
 *     not a literal EDD quote: Section 11 describes a scenario as
 *     overlaying "a baseline snapshot," and a run that has not finished
 *     has produced no snapshot to overlay.
 *  6. Every referenced building exists (NotFoundError, per building) —
 *     existence validation with a specific message, rather than relying
 *     solely on the FK-violation-to-ValidationError translation the
 *     database would otherwise produce.
 *
 * Deliberately NOT built: a method to add an override to an
 * already-created scenario. Section 19 describes scenario definition as
 * one act ("a set of attribute overrides"), not an incremental one, and
 * never describes what an override added after execution should mean —
 * inventing that operation would be inventing a business rule the EDD
 * doesn't state.
 */
export class ScenarioService extends BaseService {
  private readonly scenarioRepository: ScenarioRepository;
  private readonly scenarioOverrideRepository: ScenarioOverrideRepository;
  private readonly simulationRunRepository: SimulationRunRepository;
  private readonly buildingRepository: BuildingRepository;
  private readonly heatExposureResultRepository: HeatExposureResultRepository;
  private readonly db: Database;

  constructor(deps: ScenarioServiceDependencies = {}) {
    super(deps.logger ?? rootLogger.child({ component: 'service', service: 'ScenarioService' }));
    this.scenarioRepository = deps.scenarioRepository ?? defaultScenarioRepository;
    this.scenarioOverrideRepository =
      deps.scenarioOverrideRepository ?? defaultScenarioOverrideRepository;
    this.simulationRunRepository = deps.simulationRunRepository ?? defaultSimulationRunRepository;
    this.buildingRepository = deps.buildingRepository ?? defaultBuildingRepository;
    this.heatExposureResultRepository =
      deps.heatExposureResultRepository ?? defaultHeatExposureResultRepository;
    this.db = deps.database ?? defaultDatabase;
  }

  async getById(scenarioId: string): Promise<Scenario> {
    const scenario = await this.scenarioRepository.findById(scenarioId);
    return this.assertFound(scenario, `Scenario '${scenarioId}' not found.`);
  }

  async list(options?: ListOptions): Promise<readonly Scenario[]> {
    return this.scenarioRepository.list(options);
  }

  async createScenario(input: CreateScenarioWithOverridesInput): Promise<ScenarioWithOverrides> {
    this.validateOverrideSet(input.overrides);
    const baselineRun = await this.validateBaselineRun(input.baselineRunId);
    await this.validateOverrideBuildingsExist(input.overrides);

    const created = await this.db.withTransaction<ScenarioWithOverrides>(async (tx) => {
      const scenario = await this.scenarioRepository.create(
        {
          baselineRunId: baselineRun.runId,
          name: input.name,
          description: input.description ?? null,
          createdBy: input.createdBy ?? null,
        },
        tx,
      );

      const overrides: ScenarioOverride[] = [];
      for (const [sequenceNumber, override] of input.overrides.entries()) {
        const createdOverride = await this.scenarioOverrideRepository.create(
          {
            scenarioId: scenario.scenarioId,
            buildingId: override.buildingId,
            sequenceNumber,
            attributeName: override.attributeName,
            overrideValue: override.overrideValue,
          },
          tx,
        );
        overrides.push(createdOverride);
      }

      return { scenario, overrides };
    });

    this.logger.info(
      {
        scenarioId: created.scenario.scenarioId,
        baselineRunId: baselineRun.runId,
        overrideCount: created.overrides.length,
      },
      'scenario created',
    );

    return created;
  }

  /**
   * EDD Section 21: "retrieve scenario-vs-baseline comparison results."
   * scenarioResults is null (not an error) when the scenario has not
   * been executed yet — Section 19's "lifecycle" is reported here, not
   * enforced: only the Simulation Subsystem can ever set derivedRunId
   * (db/migrations/0014 grants that UPDATE to vektra_simulation only).
   */
  async getComparison(scenarioId: string): Promise<ScenarioComparison> {
    const scenario = await this.getById(scenarioId);
    const baselineResults = await this.heatExposureResultRepository.listByRunId(
      scenario.baselineRunId,
    );
    const scenarioResults =
      scenario.derivedRunId === null
        ? null
        : await this.heatExposureResultRepository.listByRunId(scenario.derivedRunId);

    return { scenario, baselineResults, scenarioResults };
  }

  private validateOverrideSet(overrides: readonly CreateScenarioOverrideItem[]): void {
    if (overrides.length === 0) {
      throw new ValidationError('A scenario must define at least one attribute override.');
    }

    const seen = new Set<string>();
    for (const override of overrides) {
      const key = `${override.buildingId} ${override.attributeName}`;
      if (seen.has(key)) {
        throw new ValidationError(
          `Duplicate override for building '${override.buildingId}', attribute '${override.attributeName}'.`,
        );
      }
      seen.add(key);
    }
  }

  private async validateBaselineRun(baselineRunId: string): Promise<SimulationRun> {
    const baselineRun = await this.simulationRunRepository.findById(baselineRunId);
    if (baselineRun === null) {
      throw new NotFoundError(`Simulation run '${baselineRunId}' not found.`);
    }
    if (baselineRun.runType !== 'baseline') {
      throw new ValidationError(
        `Simulation run '${baselineRunId}' is a '${baselineRun.runType}' run; a scenario must reference a baseline run.`,
      );
    }
    if (baselineRun.status !== 'completed') {
      throw new ValidationError(
        `Simulation run '${baselineRunId}' has status '${baselineRun.status}'; a scenario must reference a completed baseline run.`,
      );
    }
    return baselineRun;
  }

  private async validateOverrideBuildingsExist(
    overrides: readonly CreateScenarioOverrideItem[],
  ): Promise<void> {
    for (const override of overrides) {
      const building = await this.buildingRepository.findById(override.buildingId);
      if (building === null) {
        throw new NotFoundError(`Building '${override.buildingId}' not found.`);
      }
    }
  }
}

export const scenarioService = new ScenarioService();
