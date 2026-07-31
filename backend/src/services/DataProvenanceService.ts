import type { Logger } from 'pino';
import { dataProvenanceRecordRepository as defaultDataProvenanceRecordRepository } from '../repositories';
import type { DataProvenanceRecord } from '../models';
import type { DataProvenanceRecordRepository, ListOptions } from '../types';
import { rootLogger } from '../logging';
import { BaseService } from './BaseService';

/**
 * data_provenance_record (EDD Section 21: "Query provenance metadata for
 * any served record", Section 24 traceability). Read-only — ingestion
 * owns this table (db/migrations/0014, no backend INSERT/UPDATE grant).
 */
export class DataProvenanceService extends BaseService {
  constructor(
    private readonly dataProvenanceRecordRepository: DataProvenanceRecordRepository = defaultDataProvenanceRecordRepository,
    logger?: Logger,
  ) {
    super(logger ?? rootLogger.child({ component: 'service', service: 'DataProvenanceService' }));
  }

  async getById(provenanceId: string): Promise<DataProvenanceRecord> {
    const record = await this.dataProvenanceRecordRepository.findById(provenanceId);
    return this.assertFound(record, `Provenance record '${provenanceId}' not found.`);
  }

  async list(options?: ListOptions): Promise<readonly DataProvenanceRecord[]> {
    return this.dataProvenanceRecordRepository.list(options);
  }
}

export const dataProvenanceService = new DataProvenanceService();
