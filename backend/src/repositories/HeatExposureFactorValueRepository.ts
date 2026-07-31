import type { Database } from '../database';
import type { HeatExposureFactorValue } from '../models';
import type { FactorKey } from '../types';
import type { HeatExposureFactorValueRepository as HeatExposureFactorValueRepositoryContract } from '../types';
import { BaseRepository } from './BaseRepository';
import { toNullableNumber } from './rowMapping';

interface HeatExposureFactorValueRow {
  readonly factor_value_id: string;
  readonly result_id: string;
  readonly factor_key: string;
  readonly factor_value: string | null; // NUMERIC -> pg returns as string
  readonly is_computable: boolean;
  readonly notes: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: HeatExposureFactorValueRow): HeatExposureFactorValue {
  return {
    factorValueId: row.factor_value_id,
    resultId: row.result_id,
    factorKey: row.factor_key as FactorKey,
    factorValue: toNullableNumber(row.factor_value),
    isComputable: row.is_computable,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS =
  'factor_value_id, result_id, factor_key, factor_value, is_computable, notes, created_at, updated_at';

/**
 * heat_exposure_factor_value (db/migrations/0013). is_computable is
 * BOOLEAN — pg returns real JS booleans, no conversion needed.
 */
export class HeatExposureFactorValueRepositoryImpl
  extends BaseRepository
  implements HeatExposureFactorValueRepositoryContract
{
  /**
   * EDD Section 22: the inspection panel's "Heat Exposure Index
   * breakdown" is the per-factor values for one result.
   */
  async listByResultId(
    resultId: string,
    executor?: Database,
  ): Promise<readonly HeatExposureFactorValue[]> {
    const rows = await this.queryMany<HeatExposureFactorValueRow>(
      'HeatExposureFactorValueRepository.listByResultId',
      `SELECT ${COLUMNS} FROM heat_exposure_factor_value WHERE result_id = $1 ORDER BY factor_key ASC`,
      [resultId],
      executor,
    );
    return rows.map(mapRow);
  }
}

export const heatExposureFactorValueRepository = new HeatExposureFactorValueRepositoryImpl();
