import type { Database } from '../database';
import type { CreateSimulationRunInputDatasetInput, SimulationRunInputDataset } from '../models';
import type { SimulationRunInputDatasetRepository as SimulationRunInputDatasetRepositoryContract } from '../types';
import { BaseRepository } from './BaseRepository';

interface SimulationRunInputDatasetRow {
  readonly run_id: string;
  readonly provenance_id: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: SimulationRunInputDatasetRow): SimulationRunInputDataset {
  return {
    runId: row.run_id,
    provenanceId: row.provenance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * simulation_run_input_dataset (db/migrations/0009). Composite primary
 * key (run_id, provenance_id) — no surrogate id, so this repository
 * exposes only listByRunId per the Subsystem 7 contract, not
 * findById/list.
 */
export class SimulationRunInputDatasetRepositoryImpl
  extends BaseRepository
  implements SimulationRunInputDatasetRepositoryContract
{
  /**
   * FR-12 / EDD Section 17: "the exact input dataset versions... used,
   * sufficient to reproduce the run."
   */
  async listByRunId(
    runId: string,
    executor?: Database,
  ): Promise<readonly SimulationRunInputDataset[]> {
    const rows = await this.queryMany<SimulationRunInputDatasetRow>(
      'SimulationRunInputDatasetRepository.listByRunId',
      'SELECT run_id, provenance_id, created_at, updated_at FROM simulation_run_input_dataset WHERE run_id = $1 ORDER BY created_at ASC',
      [runId],
      executor,
    );
    return rows.map(mapRow);
  }

  /**
   * Heat Exposure Engine subsystem — the only writer (db/migrations/0014
   * grants INSERT on simulation_run_input_dataset to vektra_simulation
   * only). No RETURNING needed for the row body (there are no columns
   * beyond the composite key and timestamps), but it's used anyway to
   * confirm the insert succeeded and to get server-generated timestamps.
   */
  async create(
    input: CreateSimulationRunInputDatasetInput,
    executor?: Database,
  ): Promise<SimulationRunInputDataset> {
    const row = await this.queryOne<SimulationRunInputDatasetRow>(
      'SimulationRunInputDatasetRepository.create',
      `INSERT INTO simulation_run_input_dataset (run_id, provenance_id)
       VALUES ($1, $2)
       RETURNING run_id, provenance_id, created_at, updated_at`,
      [input.runId, input.provenanceId],
      executor,
    );
    if (!row) {
      throw new Error(
        'SimulationRunInputDatasetRepository.create: INSERT RETURNING produced no row.',
      );
    }
    return mapRow(row);
  }
}

export const simulationRunInputDatasetRepository = new SimulationRunInputDatasetRepositoryImpl();
