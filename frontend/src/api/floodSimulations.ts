import { exportUrl, getJson, postJson } from './client';
import type {
  FloodOutputSummary,
  FloodSimulationArtifact,
  FloodSimulationRunStatus,
  FloodSimulationSubmitResult,
  SubmitFloodSimulationRequest,
} from './types';

/**
 * POST/GET /api/flood-simulations/* — backend/src/api/routes/floodSimulations.ts
 * exactly (Step 20 Part 0b). Same {data} envelope, same base URL, same
 * getJson/postJson/exportUrl this codebase already uses for every other
 * resource (simulationRuns.ts) — no new HTTP plumbing needed.
 */

export function submitFloodSimulation(
  request: SubmitFloodSimulationRequest,
): Promise<FloodSimulationSubmitResult> {
  return postJson<FloodSimulationSubmitResult>('/api/flood-simulations', request);
}

export function getFloodSimulationStatus(runId: string): Promise<FloodSimulationRunStatus> {
  return getJson<FloodSimulationRunStatus>(`/api/flood-simulations/${runId}`);
}

export function getFloodSimulationSummary(runId: string): Promise<FloodOutputSummary> {
  return getJson<FloodOutputSummary>(`/api/flood-simulations/${runId}/summary`);
}

/** For a direct-download link (raw .npy artifact) — never fetched programmatically, matching exportUrl()'s existing contract. */
export function floodSimulationDownloadUrl(
  runId: string,
  artifact: FloodSimulationArtifact,
): string {
  return exportUrl(`/api/flood-simulations/${runId}/download/${artifact}`);
}

export function cancelFloodSimulation(runId: string): Promise<FloodSimulationRunStatus> {
  return postJson<FloodSimulationRunStatus>(`/api/flood-simulations/${runId}/cancel`, {});
}
