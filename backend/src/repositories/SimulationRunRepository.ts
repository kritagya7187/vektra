import type { Database } from '../database';
import type { SimulationRun } from '../models';
import type { RunType, SimulationRunStatus } from '../types';
import type {
  ListOptions,
  SimulationRunRepository as SimulationRunRepositoryContract,
} from '../types';
import { BaseRepository } from './BaseRepository';

const DEFAULT_LIST_LIMIT = 50;

interface SimulationRunRow {
  readonly run_id: string;
  readonly code_version: string;
  readonly configuration_version: string;
  readonly run_type: string;
  readonly baseline_run_id: string | null;
  readonly status: string;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly error_message: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: SimulationRunRow): SimulationRun {
  return {
    runId: row.run_id,
    codeVersion: row.code_version,
    configurationVersion: row.configuration_version,
    runType: row.run_type as RunType,
    baselineRunId: row.baseline_run_id,
    status: row.status as SimulationRunStatus,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `
  run_id, code_version, configuration_version, run_type, baseline_run_id, status,
  started_at, completed_at, error_message, created_at, updated_at
`;

/**
 * simulation_run (db/migrations/0008). No NUMERIC/BIGINT/geometry
 * columns — plain field mapping.
 */
export class SimulationRunRepositoryImpl
  extends BaseRepository
  implements SimulationRunRepositoryContract
{
  async findById(runId: string, executor?: Database): Promise<SimulationRun | null> {
    const row = await this.queryOne<SimulationRunRow>(
      'SimulationRunRepository.findById',
      `SELECT ${COLUMNS} FROM simulation_run WHERE run_id = $1`,
      [runId],
      executor,
    );
    return row ? mapRow(row) : null;
  }

  async list(options?: ListOptions, executor?: Database): Promise<readonly SimulationRun[]> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options?.offset ?? 0;
    const rows = await this.queryMany<SimulationRunRow>(
      'SimulationRunRepository.list',
      `SELECT ${COLUMNS} FROM simulation_run ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
      executor,
    );
    return rows.map(mapRow);
  }

  /**
   * EDD Section 21, verbatim: "Query Heat Exposure Index results for a
   * given simulation run (default: latest baseline run)."
   *
   * Would benefit from the composite index (run_type, status,
   * created_at DESC) recommended in the earlier DB architectural review
   * but never applied — this subsystem is barred from migrations, so
   * that stands as an open follow-up, not fixed here.
   */
  async findLatestBaselineRun(executor?: Database): Promise<SimulationRun | null> {
    const row = await this.queryOne<SimulationRunRow>(
      'SimulationRunRepository.findLatestBaselineRun',
      `SELECT ${COLUMNS} FROM simulation_run
       WHERE run_type = 'baseline' AND status = 'completed'
       ORDER BY created_at DESC
       LIMIT 1`,
      [],
      executor,
    );
    return row ? mapRow(row) : null;
  }
}

export const simulationRunRepository = new SimulationRunRepositoryImpl();
