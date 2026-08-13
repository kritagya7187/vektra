import { getJson } from './client';
import type { DataProvenanceRecord, DataSource } from './types';
export function getDataProvenanceRecord(provenanceId: string): Promise<DataProvenanceRecord> {
  return getJson<DataProvenanceRecord>(`/api/data-provenance/${provenanceId}`);
}
export function getDataSource(sourceCode: string): Promise<DataSource> {
  return getJson<DataSource>(`/api/data-sources/${encodeURIComponent(sourceCode)}`);
}
