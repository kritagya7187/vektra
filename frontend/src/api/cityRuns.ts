import { exportUrl, getJson } from './client';
import type { CityRunArtifact, CityRunBoundary, CityRunDetail, CityRunSummary } from './types';
export function listCityRuns(): Promise<readonly CityRunSummary[]> {
  return getJson<readonly CityRunSummary[]>('/api/city-runs');
}
export function getCityRun(runId: string): Promise<CityRunDetail> {
  return getJson<CityRunDetail>(`/api/city-runs/${runId}`);
}
export function getCityRunBoundary(runId: string): Promise<CityRunBoundary> {
  return getJson<CityRunBoundary>(`/api/city-runs/${runId}/boundary`);
}
export function cityRunDownloadUrl(runId: string, artifact: CityRunArtifact): string {
  return exportUrl(`/api/city-runs/${runId}/download/${artifact}`);
}
