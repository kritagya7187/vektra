import type { Logger } from 'pino';
import { dataSourceRepository as defaultDataSourceRepository } from '../repositories';
import type { DataSource } from '../models';
import type { DataSourceRepository, ListOptions } from '../types';
import { rootLogger } from '../logging';
import { BaseService } from './BaseService';

/**
 * data_source (EDD Section 13): a fixed, small catalogue of upstream
 * providers. Read-only — vektra_backend_api has no INSERT/UPDATE grant
 * on data_source (db/migrations/0014); ingestion owns this table. No
 * business rules beyond existence validation apply here.
 */
export class DataSourceService extends BaseService {
  constructor(
    private readonly dataSourceRepository: DataSourceRepository = defaultDataSourceRepository,
    logger?: Logger,
  ) {
    super(logger ?? rootLogger.child({ component: 'service', service: 'DataSourceService' }));
  }

  async getById(sourceCode: string): Promise<DataSource> {
    const dataSource = await this.dataSourceRepository.findById(sourceCode);
    return this.assertFound(dataSource, `Data source '${sourceCode}' not found.`);
  }

  async list(options?: ListOptions): Promise<readonly DataSource[]> {
    return this.dataSourceRepository.list(options);
  }
}

export const dataSourceService = new DataSourceService();
