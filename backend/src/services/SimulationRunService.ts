import type { Logger } from 'pino';
import { simulationRunRepository as defaultSimulationRunRepository } from '../repositories';
import type { SimulationRun } from '../models';
import type { ListOptions, SimulationRunRepository } from '../types';
import { rootLogger } from '../logging';
import { BaseService } from './BaseService';

/**
 * simulation_run (EDD Section 17, Derived/Computed Layer). Read-only:
 * vektra_backend_api has no INSERT/UPDATE grant on simulation_run
 * (db/migrations/0014) — whether/how the backend ever triggers a run is
 * explicitly undecided (that migration's own open TODO), so no
 * `create`/`trigger` method exists here, matching the Server Bootstrap
 * subsystem's earlier decision to return 501 for simulation execution
 * endpoints rather than guess at a triggering mechanism.
 *
 * "Reproducibility rules" (EDD Section 17: identical inputs must
 * produce numerically identical output) are a simulation-ENGINE
 * concern, out of scope everywhere in this backend. The one thing this
 * layer can and does uphold is that a run's identity fields are never
 * exposed as mutable here — there is no update method, by omission,
 * matching fn_guard_simulation_run_update at the database level.
 */
export class SimulationRunService extends BaseService {
  constructor(
    private readonly simulationRunRepository: SimulationRunRepository = defaultSimulationRunRepository,
    logger?: Logger,
  ) {
    super(logger ?? rootLogger.child({ component: 'service', service: 'SimulationRunService' }));
  }

  async getById(runId: string): Promise<SimulationRun> {
    const run = await this.simulationRunRepository.findById(runId);
    return this.assertFound(run, `Simulation run '${runId}' not found.`);
  }

  async list(options?: ListOptions): Promise<readonly SimulationRun[]> {
    return this.simulationRunRepository.list(options);
  }

  /**
   * Deliberately returns null rather than throwing: "no completed
   * baseline run exists yet" is normal, expected system state (e.g. a
   * freshly provisioned environment before the Simulation Subsystem has
   * run once), not a failure of this query. Callers (HeatExposureResultService,
   * ScenarioService) each decide whether null is an error in their own
   * context.
   */
  async getLatestBaselineRun(): Promise<SimulationRun | null> {
    return this.simulationRunRepository.findLatestBaselineRun();
  }
}

export const simulationRunService = new SimulationRunService();
