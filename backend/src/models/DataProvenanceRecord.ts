/**
 * data_provenance_record (db/migrations/0004). DataProvenanceRecord
 * entity (EDD Section 16, 24) — also fulfills the "dataset version" role
 * (Section 27; see the migration's own header comment for why no
 * separate dataset_version entity exists).
 */
export interface DataProvenanceRecord {
  readonly provenanceId: string;
  readonly sourceCode: string;
  readonly sourceProductIdentifier: string;
  readonly retrievalTimestamp: Date;
  readonly license: string;
  readonly ingestionPipelineVersion: string;
  readonly checksum: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
