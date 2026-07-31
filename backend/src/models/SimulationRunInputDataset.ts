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
