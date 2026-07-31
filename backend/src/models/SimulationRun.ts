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

/**
 * Input shape for creating a SimulationRun (Heat Exposure Engine
 * subsystem — the only writer, matching db/migrations/0014's INSERT
 * grant to vektra_simulation, never vektra_backend_api). A run always
 * starts at status='pending' with no started_at/completed_at/
 * error_message — those are set later via UpdateSimulationRunStatusInput,
 * matching fn_guard_simulation_run_update's split between immutable
 * identity columns (set once, here) and the mutable lifecycle columns.
 */
export interface CreateSimulationRunInput {
  readonly codeVersion: string;
  readonly configurationVersion: string;
  readonly runType: RunType;
  readonly baselineRunId?: string | null;
}

/**
 * Input shape for the ONLY update simulation_run ever permits
 * (fn_guard_simulation_run_update, db/migrations/0008): the lifecycle
 * columns, never the identity columns set at creation.
 */
export interface UpdateSimulationRunStatusInput {
  readonly status: SimulationRunStatus;
  readonly startedAt?: Date | null;
  readonly completedAt?: Date | null;
  readonly errorMessage?: string | null;
}
