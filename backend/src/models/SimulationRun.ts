import type { RunType, SimulationRunStatus } from '../types/enums';

/**
 * simulation_run (db/migrations/0008). SimulationRun entity (EDD Section
 * 16, 17), Derived/Computed Layer (Section 15). One row per execution of
 * the deterministic simulation engine.
 *
 * baselineRunId is a self-reference used only by scenario-type runs
 * (Section 11). status/startedAt/completedAt/errorMessage are the only
 * mutable columns post-creation (fn_guard_simulation_run_update); every
 * other field is frozen at creation, matching this interface's own
 * overall immutability.
 */
export interface SimulationRun {
  readonly runId: string;
  readonly codeVersion: string;
  readonly configurationVersion: string;
  readonly runType: RunType;
  readonly baselineRunId: string | null;
  readonly status: SimulationRunStatus;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
