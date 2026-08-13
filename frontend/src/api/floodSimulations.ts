import { exportUrl, getJson, postJson } from './client';
import type {
  FloodOutputSummary,
  FloodSimulationArtifact,
  FloodSimulationRunStatus,
  FloodSimulationSubmitResult,
  SubmitFloodSimulationRequest,
} from './types';
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
export function floodSimulationDownloadUrl(
  runId: string,
  artifact: FloodSimulationArtifact,
): string {
  return exportUrl(`/api/flood-simulations/${runId}/download/${artifact}`);
}
export function cancelFloodSimulation(runId: string): Promise<FloodSimulationRunStatus> {
  return postJson<FloodSimulationRunStatus>(`/api/flood-simulations/${runId}/cancel`, {});
}
