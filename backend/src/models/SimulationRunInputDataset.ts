/**
 * simulation_run_input_dataset (db/migrations/0009). Join table recording
 * the exact set of dataset versions (data_provenance_record rows) a
 * simulation run consumed — realizes FR-12 and Section 17's "exact input
 * version identifiers used." Composite primary key (runId, provenanceId);
 * no separate surrogate id column exists in the schema.
 */
export interface SimulationRunInputDataset {
  readonly runId: string;
  readonly provenanceId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Input shape for creating a SimulationRunInputDataset row (Heat
 * Exposure Engine subsystem — the only writer, matching
 * db/migrations/0014's INSERT grant to vektra_simulation). No fields
 * beyond the composite key: the row has no other columns to populate.
 */
export interface CreateSimulationRunInputDatasetInput {
  readonly runId: string;
  readonly provenanceId: string;
}
