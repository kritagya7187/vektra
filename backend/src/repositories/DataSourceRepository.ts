import type { Database } from '../database';
import type { DataSource } from '../models';
import type { DataSourceRepository as DataSourceRepositoryContract, ListOptions } from '../types';
import { BaseRepository } from './BaseRepository';

const DEFAULT_LIST_LIMIT = 50;

interface DataSourceRow {
  readonly source_code: string;
  readonly display_name: string;
  readonly license: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: DataSourceRow): DataSource {
  return {
    sourceCode: row.source_code,
    displayName: row.display_name,
    license: row.license,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = 'source_code, display_name, license, created_at, updated_at';

/** data_source (db/migrations/0003). No NUMERIC/BIGINT/geometry columns — plain field mapping. */
export class DataSourceRepositoryImpl
  extends BaseRepository
  implements DataSourceRepositoryContract
{
  async findById(sourceCode: string, executor?: Database): Promise<DataSource | null> {
    const row = await this.queryOne<DataSourceRow>(
      'DataSourceRepository.findById',
      `SELECT ${COLUMNS} FROM data_source WHERE source_code = $1`,
      [sourceCode],
      executor,
    );
    return row ? mapRow(row) : null;
  }

  async list(options?: ListOptions, executor?: Database): Promise<readonly DataSource[]> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options?.offset ?? 0;
    const rows = await this.queryMany<DataSourceRow>(
      'DataSourceRepository.list',
      `SELECT ${COLUMNS} FROM data_source ORDER BY source_code ASC LIMIT $1 OFFSET $2`,
      [limit, offset],
      executor,
    );
    return rows.map(mapRow);
  }
}

export const dataSourceRepository = new DataSourceRepositoryImpl();
