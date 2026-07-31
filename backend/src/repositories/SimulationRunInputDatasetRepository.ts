import type { Database } from '../database';
import type { SimulationRunInputDataset } from '../models';
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
}

export const simulationRunInputDatasetRepository = new SimulationRunInputDatasetRepositoryImpl();
