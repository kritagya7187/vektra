import type { Database } from '../database';
import type { MeteorologicalObservation } from '../models';
import type { MeteorologicalDataSourceCode } from '../types';
import type {
  ListOptions,
  MeteorologicalObservationRepository as MeteorologicalObservationRepositoryContract,
} from '../types';
import type { GeoJsonPoint } from '../types/geometry';
import { BaseRepository } from './BaseRepository';
import { toNumber } from './rowMapping';

const DEFAULT_LIST_LIMIT = 50;

interface MeteorologicalObservationRow {
  readonly met_observation_id: string;
  readonly source_code: string;
  readonly observation_timestamp: Date;
  readonly location: GeoJsonPoint; // ST_AsGeoJSON(...)::json -> already parsed
  readonly variable_name: string;
  readonly variable_value: string; // NUMERIC -> pg returns as string
  readonly variable_unit: string;
  readonly provenance_id: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: MeteorologicalObservationRow): MeteorologicalObservation {
  return {
    metObservationId: row.met_observation_id,
    sourceCode: row.source_code as MeteorologicalDataSourceCode,
    observationTimestamp: row.observation_timestamp,
    location: row.location,
    variableName: row.variable_name,
    variableValue: toNumber(row.variable_value),
    variableUnit: row.variable_unit,
    provenanceId: row.provenance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `
  met_observation_id, source_code, observation_timestamp,
  ST_AsGeoJSON(location)::json AS location,
  variable_name, variable_value, variable_unit, provenance_id, created_at, updated_at
`;

/** meteorological_observation (db/migrations/0007). */
export class MeteorologicalObservationRepositoryImpl
  extends BaseRepository
  implements MeteorologicalObservationRepositoryContract
{
  async findById(
    metObservationId: string,
    executor?: Database,
  ): Promise<MeteorologicalObservation | null> {
    const row = await this.queryOne<MeteorologicalObservationRow>(
      'MeteorologicalObservationRepository.findById',
      `SELECT ${COLUMNS} FROM meteorological_observation WHERE met_observation_id = $1`,
      [metObservationId],
      executor,
    );
    return row ? mapRow(row) : null;
  }

  async list(
    options?: ListOptions,
    executor?: Database,
  ): Promise<readonly MeteorologicalObservation[]> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options?.offset ?? 0;
    const rows = await this.queryMany<MeteorologicalObservationRow>(
      'MeteorologicalObservationRepository.list',
      `SELECT ${COLUMNS} FROM meteorological_observation ORDER BY observation_timestamp DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
      executor,
    );
    return rows.map(mapRow);
  }
}

export const meteorologicalObservationRepository = new MeteorologicalObservationRepositoryImpl();
