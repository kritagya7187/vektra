import type { Logger } from 'pino';
import {
  heatExposureFactorValueRepository as defaultHeatExposureFactorValueRepository,
  heatExposureResultRepository as defaultHeatExposureResultRepository,
  simulationRunRepository as defaultSimulationRunRepository,
} from '../repositories';
import type { HeatExposureFactorValue, HeatExposureResult } from '../models';
import type {
  HeatExposureFactorValueRepository,
  HeatExposureResultRepository,
  SimulationRunRepository,
} from '../types';
import { NotFoundError } from '../errors';
import { rootLogger } from '../logging';
import { BaseService } from './BaseService';

export interface HeatExposureResultWithFactors {
  readonly result: HeatExposureResult;
  readonly factors: readonly HeatExposureFactorValue[];
}

export interface HeatExposureResultServiceDependencies {
  readonly heatExposureResultRepository?: HeatExposureResultRepository;
  readonly heatExposureFactorValueRepository?: HeatExposureFactorValueRepository;
  readonly simulationRunRepository?: SimulationRunRepository;
  readonly logger?: Logger;
}

/**
 * heat_exposure_result / heat_exposure_factor_value (EDD Section 16, 18,
 * 21, 22). Read-only — vektra_backend_api has no INSERT/UPDATE grant on
 * either table (db/migrations/0014); the (unbuilt) Simulation Subsystem
 * is the only writer.
 *
 * Two real orchestration rules live here, both cited directly:
 *  - `listForRun`: EDD Section 21, verbatim — "Query Heat Exposure Index
 *    results for a given simulation run (default: latest baseline run)."
 *    An omitted runId is not an error by itself; it only becomes
 *    NotFoundError if no completed baseline run exists at all yet, since
 *    at that point there is nothing to default to.
 *  - `getWithFactors`: EDD Section 22's inspection panel needs a result
 *    AND its per-factor breakdown together — composing two repositories
 *    is exactly "application orchestration" (item 1 of this subsystem's
 *    brief), not new business logic.
 *
 * Depends directly on SimulationRunRepository (not SimulationRunService)
 * to keep every service's dependency graph flat — repositories only,
 * per item 1's "depend only on repository interfaces."
 */
export class HeatExposureResultService extends BaseService {
  private readonly heatExposureResultRepository: HeatExposureResultRepository;
  private readonly heatExposureFactorValueRepository: HeatExposureFactorValueRepository;
  private readonly simulationRunRepository: SimulationRunRepository;

  constructor(deps: HeatExposureResultServiceDependencies = {}) {
    super(
      deps.logger ??
        rootLogger.child({ component: 'service', service: 'HeatExposureResultService' }),
    );
    this.heatExposureResultRepository =
      deps.heatExposureResultRepository ?? defaultHeatExposureResultRepository;
    this.heatExposureFactorValueRepository =
      deps.heatExposureFactorValueRepository ?? defaultHeatExposureFactorValueRepository;
    this.simulationRunRepository = deps.simulationRunRepository ?? defaultSimulationRunRepository;
  }

  async getById(resultId: string): Promise<HeatExposureResult> {
    const result = await this.heatExposureResultRepository.findById(resultId);
    return this.assertFound(result, `Heat exposure result '${resultId}' not found.`);
  }

  async getWithFactors(resultId: string): Promise<HeatExposureResultWithFactors> {
    const result = await this.getById(resultId);
    const factors = await this.heatExposureFactorValueRepository.listByResultId(resultId);
    return { result, factors };
  }

  /**
   * EDD Section 21: "default: latest baseline run."
   */
  async listForRun(runId?: string): Promise<readonly HeatExposureResult[]> {
    const resolvedRunId = await this.resolveRunId(runId);
    return this.heatExposureResultRepository.listByRunId(resolvedRunId);
  }

  /**
   * Batch counterpart to getWithFactors — every factor row for every
   * result under one run (or the latest baseline run, same
   * default-resolution rule as listForRun), for scene-wide
   * visualization. Returns plain HeatExposureFactorValue rows
   * (resultId, not buildingId) — a caller that already has the run's
   * HeatExposureResult[] (e.g. via listForRun) already holds the
   * resultId->buildingId join key, so denormalizing buildingId onto
   * every factor row here would be redundant, not simpler.
   */
  async listFactorsForRun(runId?: string): Promise<readonly HeatExposureFactorValue[]> {
    const resolvedRunId = await this.resolveRunId(runId);
    return this.heatExposureFactorValueRepository.listByRunId(resolvedRunId);
  }

  /** Shared by listForRun/listFactorsForRun — EDD Section 21's "default: latest baseline run" rule, resolved once. */
  private async resolveRunId(runId?: string): Promise<string> {
    if (runId !== undefined) {
      return runId;
    }

    const latestBaseline = await this.simulationRunRepository.findLatestBaselineRun();
    if (latestBaseline === null) {
      throw new NotFoundError('No completed baseline simulation run is available to default to.');
    }
    this.logger.info(
      { runId: latestBaseline.runId },
      'defaulted heat exposure result query to latest baseline run',
    );
    return latestBaseline.runId;
  }
}

export const heatExposureResultService = new HeatExposureResultService();
