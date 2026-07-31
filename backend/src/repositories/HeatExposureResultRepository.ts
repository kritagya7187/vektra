import type { Database } from '../database';
import type { CreateHeatExposureResultInput, HeatExposureResult } from '../models';
import type {
  HeatExposureResultRepository as HeatExposureResultRepositoryContract,
  ListOptions,
} from '../types';
import { BaseRepository } from './BaseRepository';
import { toNullableNumber } from './rowMapping';

const DEFAULT_LIST_LIMIT = 50;

interface HeatExposureResultRow {
  readonly result_id: string;
  readonly run_id: string;
  readonly building_id: string;
  readonly index_value: string | null; // NUMERIC -> pg returns as string
  readonly computed_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: HeatExposureResultRow): HeatExposureResult {
  return {
    resultId: row.result_id,
    runId: row.run_id,
    buildingId: row.building_id,
    indexValue: toNullableNumber(row.index_value),
    computedAt: row.computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = 'result_id, run_id, building_id, index_value, computed_at, created_at, updated_at';

/**
 * heat_exposure_result (db/migrations/0012). indexValue is nullable —
 * Section 18's combination methodology is "Requires future
 * implementation," so real rows commonly have this column NULL.
 */
export class HeatExposureResultRepositoryImpl
  extends BaseRepository
  implements HeatExposureResultRepositoryContract
{
  async findById(resultId: string, executor?: Database): Promise<HeatExposureResult | null> {
    const row = await this.queryOne<HeatExposureResultRow>(
      'HeatExposureResultRepository.findById',
      `SELECT ${COLUMNS} FROM heat_exposure_result WHERE result_id = $1`,
      [resultId],
      executor,
    );
    return row ? mapRow(row) : null;
  }

  async list(options?: ListOptions, executor?: Database): Promise<readonly HeatExposureResult[]> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options?.offset ?? 0;
    const rows = await this.queryMany<HeatExposureResultRow>(
      'HeatExposureResultRepository.list',
      `SELECT ${COLUMNS} FROM heat_exposure_result ORDER BY computed_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
      executor,
    );
    return rows.map(mapRow);
  }

  /**
   * EDD Section 21: results "for a given simulation run" — every
   * building's result for one run, the unit both the "latest baseline
   * run" query and scenario-vs-baseline comparison are built from.
   */
  async listByRunId(runId: string, executor?: Database): Promise<readonly HeatExposureResult[]> {
    const rows = await this.queryMany<HeatExposureResultRow>(
      'HeatExposureResultRepository.listByRunId',
      `SELECT ${COLUMNS} FROM heat_exposure_result WHERE run_id = $1 ORDER BY building_id ASC`,
      [runId],
      executor,
    );
    return rows.map(mapRow);
  }

  /**
   * Heat Exposure Engine subsystem — the only writer (db/migrations/0014
   * grants INSERT on heat_exposure_result to vektra_simulation only).
   * indexValue is always omitted/null by this subsystem's own service —
   * see this repository's own class comment and the engineering review
   * for why the composite index is never computed.
   */
  async create(
    input: CreateHeatExposureResultInput,
    executor?: Database,
  ): Promise<HeatExposureResult> {
    const row = await this.queryOne<HeatExposureResultRow>(
      'HeatExposureResultRepository.create',
      `INSERT INTO heat_exposure_result (run_id, building_id, index_value)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [input.runId, input.buildingId, input.indexValue ?? null],
      executor,
    );
    if (!row) {
      throw new Error('HeatExposureResultRepository.create: INSERT RETURNING produced no row.');
    }
    return mapRow(row);
  }
}

export const heatExposureResultRepository = new HeatExposureResultRepositoryImpl();
