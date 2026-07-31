import type { Database } from '../database';
import type { CreateScenarioOverrideInput, ScenarioOverride } from '../models';
import type { ScenarioOverrideRepository as ScenarioOverrideRepositoryContract } from '../types';
import { BaseRepository } from './BaseRepository';

interface ScenarioOverrideRow {
  readonly override_id: string;
  readonly scenario_id: string;
  readonly building_id: string;
  readonly sequence_number: number;
  readonly attribute_name: string;
  readonly override_value: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: ScenarioOverrideRow): ScenarioOverride {
  return {
    overrideId: row.override_id,
    scenarioId: row.scenario_id,
    buildingId: row.building_id,
    sequenceNumber: row.sequence_number,
    attributeName: row.attribute_name,
    overrideValue: row.override_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `
  override_id, scenario_id, building_id, sequence_number, attribute_name, override_value,
  created_at, updated_at
`;

/**
 * scenario_override (db/migrations/0011). sequence_number is INTEGER —
 * pg returns real numbers for INTEGER, no conversion needed (unlike
 * NUMERIC/BIGINT).
 */
export class ScenarioOverrideRepositoryImpl
  extends BaseRepository
  implements ScenarioOverrideRepositoryContract
{
  async create(input: CreateScenarioOverrideInput, executor?: Database): Promise<ScenarioOverride> {
    const row = await this.queryOne<ScenarioOverrideRow>(
      'ScenarioOverrideRepository.create',
      `INSERT INTO scenario_override (scenario_id, building_id, sequence_number, attribute_name, override_value)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [
        input.scenarioId,
        input.buildingId,
        input.sequenceNumber,
        input.attributeName,
        input.overrideValue,
      ],
      executor,
    );
    if (!row) {
      throw new Error('ScenarioOverrideRepository.create: INSERT RETURNING produced no row.');
    }
    return mapRow(row);
  }

  /**
   * EDD Section 15: overlays are "resolved at simulation time" — every
   * override for one scenario, in the order sequence_number preserves.
   */
  async listByScenarioId(
    scenarioId: string,
    executor?: Database,
  ): Promise<readonly ScenarioOverride[]> {
    const rows = await this.queryMany<ScenarioOverrideRow>(
      'ScenarioOverrideRepository.listByScenarioId',
      `SELECT ${COLUMNS} FROM scenario_override WHERE scenario_id = $1 ORDER BY sequence_number ASC`,
      [scenarioId],
      executor,
    );
    return rows.map(mapRow);
  }
}

export const scenarioOverrideRepository = new ScenarioOverrideRepositoryImpl();
