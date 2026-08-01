import { ApiError } from './errors';
import { exportUrl, getJson } from './client';
import type { SimulationRun } from './types';

/** GET /simulation-runs, /simulation-runs/latest-baseline, /simulation-runs/:id — backend/src/api/routes/simulationRuns.ts exactly. */

export function getSimulationRun(runId: string): Promise<SimulationRun> {
  return getJson<SimulationRun>(`/api/simulation-runs/${runId}`);
}

/**
 * Returns null when no completed baseline run exists yet — a real,
 * documented, non-error system state (SimulationRunController's own
 * getLatestBaselineSimulationRun note), NOT surfaced as a thrown error
 * to callers. The backend itself returns 404/NOT_FOUND for this case;
 * this function is the one place that 404 is translated back into an
 * expected null rather than an exception, matching the design review's
 * distinction between expected and genuine absence (§13).
 */
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
