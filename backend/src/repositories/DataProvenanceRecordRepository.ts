import type { Database } from '../database';
import type { DataProvenanceRecord } from '../models';
import type {
  DataProvenanceRecordRepository as DataProvenanceRecordRepositoryContract,
  ListOptions,
} from '../types';
import { BaseRepository } from './BaseRepository';

const DEFAULT_LIST_LIMIT = 50;

interface DataProvenanceRecordRow {
  readonly provenance_id: string;
  readonly source_code: string;
  readonly source_product_identifier: string;
  readonly retrieval_timestamp: Date;
  readonly license: string;
  readonly ingestion_pipeline_version: string;
  readonly checksum: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: DataProvenanceRecordRow): DataProvenanceRecord {
  return {
    provenanceId: row.provenance_id,
    sourceCode: row.source_code,
    sourceProductIdentifier: row.source_product_identifier,
    retrievalTimestamp: row.retrieval_timestamp,
    license: row.license,
    ingestionPipelineVersion: row.ingestion_pipeline_version,
    checksum: row.checksum,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS =
  'provenance_id, source_code, source_product_identifier, retrieval_timestamp, license, ingestion_pipeline_version, checksum, created_at, updated_at';

/** data_provenance_record (db/migrations/0004). No NUMERIC/BIGINT/geometry columns. */
export class DataProvenanceRecordRepositoryImpl
  extends BaseRepository
  implements DataProvenanceRecordRepositoryContract
{
  async findById(provenanceId: string, executor?: Database): Promise<DataProvenanceRecord | null> {
    const row = await this.queryOne<DataProvenanceRecordRow>(
      'DataProvenanceRecordRepository.findById',
      `SELECT ${COLUMNS} FROM data_provenance_record WHERE provenance_id = $1`,
      [provenanceId],
      executor,
    );
    return row ? mapRow(row) : null;
  }

  async list(options?: ListOptions, executor?: Database): Promise<readonly DataProvenanceRecord[]> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options?.offset ?? 0;
    const rows = await this.queryMany<DataProvenanceRecordRow>(
      'DataProvenanceRecordRepository.list',
      `SELECT ${COLUMNS} FROM data_provenance_record ORDER BY retrieval_timestamp DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
      executor,
    );
    return rows.map(mapRow);
  }
}

export const dataProvenanceRecordRepository = new DataProvenanceRecordRepositoryImpl();
