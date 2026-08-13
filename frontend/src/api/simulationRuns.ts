import { ApiError } from './errors';
import { exportUrl, getJson } from './client';
import type { SimulationRun } from './types';
export function getSimulationRun(runId: string): Promise<SimulationRun> {
  return getJson<SimulationRun>(`/api/simulation-runs/${runId}`);
}
export async function getLatestBaselineRun(): Promise<SimulationRun | null> {
  try {
    return await getJson<SimulationRun>('/api/simulation-runs/latest-baseline');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      return null;
    }
    throw err;
  }
}
export function listSimulationRunsPage(
  limit: number,
  offset: number,
): Promise<readonly SimulationRun[]> {
  return getJson<readonly SimulationRun[]>('/api/simulation-runs', {
    limit: String(limit),
    offset: String(offset),
  });
}
export function simulationRunsCsvExportUrl(): string {
  return exportUrl('/api/simulation-runs/export', { format: 'csv' });
}
