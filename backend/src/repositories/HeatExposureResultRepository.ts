import type { Database } from '../database';
import type { HeatExposureResult } from '../models';
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
}

export const heatExposureResultRepository = new HeatExposureResultRepositoryImpl();
