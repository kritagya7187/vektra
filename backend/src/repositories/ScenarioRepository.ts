import type { Database } from '../database';
import type { CreateScenarioInput, Scenario } from '../models';
import type { ListOptions, ScenarioRepository as ScenarioRepositoryContract } from '../types';
import { BaseRepository } from './BaseRepository';

const DEFAULT_LIST_LIMIT = 50;

interface ScenarioRow {
  readonly scenario_id: string;
  readonly baseline_run_id: string;
  readonly derived_run_id: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: ScenarioRow): Scenario {
  return {
    scenarioId: row.scenario_id,
    baselineRunId: row.baseline_run_id,
    derivedRunId: row.derived_run_id,
    name: row.name,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `
  scenario_id, baseline_run_id, derived_run_id, name, description, created_by,
  created_at, updated_at
`;

/**
 * scenario (db/migrations/0010). The only write path in this subsystem
 * besides ScenarioOverride, matching db/migrations/0014's actual INSERT
 * grant to vektra_backend_api. create() uses RETURNING so the fully
 * populated row (server-generated scenarioId, createdAt, updatedAt)
 * comes back in one round trip.
 */
export class ScenarioRepositoryImpl extends BaseRepository implements ScenarioRepositoryContract {
  async findById(scenarioId: string, executor?: Database): Promise<Scenario | null> {
    const row = await this.queryOne<ScenarioRow>(
      'ScenarioRepository.findById',
      `SELECT ${COLUMNS} FROM scenario WHERE scenario_id = $1`,
      [scenarioId],
      executor,
    );
    return row ? mapRow(row) : null;
  }

  async list(options?: ListOptions, executor?: Database): Promise<readonly Scenario[]> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options?.offset ?? 0;
    const rows = await this.queryMany<ScenarioRow>(
      'ScenarioRepository.list',
      `SELECT ${COLUMNS} FROM scenario ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
      executor,
    );
    return rows.map(mapRow);
  }

  async create(input: CreateScenarioInput, executor?: Database): Promise<Scenario> {
    const row = await this.queryOne<ScenarioRow>(
      'ScenarioRepository.create',
      `INSERT INTO scenario (baseline_run_id, name, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [input.baselineRunId, input.name, input.description ?? null, input.createdBy ?? null],
      executor,
    );
    if (!row) {
      // INSERT ... RETURNING always returns exactly one row on success;
      // reaching this means the query itself failed silently, which
      // should never happen — queryOne would have thrown first.
      throw new Error('ScenarioRepository.create: INSERT RETURNING produced no row.');
    }
    return mapRow(row);
  }
}

export const scenarioRepository = new ScenarioRepositoryImpl();
