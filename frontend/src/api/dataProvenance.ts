import { getJson } from './client';
import type { DataProvenanceRecord, DataSource } from './types';

/** GET /data-provenance/:id, /data-sources/:id — the Provenance Inspector's two data sources (design review §4 item 4, §22's "source, version, retrieval timestamp"). */

export function getDataProvenanceRecord(provenanceId: string): Promise<DataProvenanceRecord> {
  return getJson<DataProvenanceRecord>(`/api/data-provenance/${provenanceId}`);
}

export function getDataSource(sourceCode: string): Promise<DataSource> {
  return getJson<DataSource>(`/api/data-sources/${encodeURIComponent(sourceCode)}`);
}
