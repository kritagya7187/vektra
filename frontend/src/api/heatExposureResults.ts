import { exportUrl, getJson } from './client';
import type { HeatExposureFactorValue, HeatExposureResult } from './types';

/**
 * GET /heat-exposure-results, /:id, /:id/factors —
 * backend/src/api/routes/heatExposureResults.ts exactly. listForRun has
 * no pagination (the underlying service has none) — it returns every
 * result for one run in a single response, which is also exactly what
 * §7's building/result join needs.
 */

export function listHeatExposureResultsForRun(
  runId?: string,
): Promise<readonly HeatExposureResult[]> {
  return getJson<readonly HeatExposureResult[]>('/api/heat-exposure-results', { runId });
}

export function getHeatExposureResult(resultId: string): Promise<HeatExposureResult> {
  return getJson<HeatExposureResult>(`/api/heat-exposure-results/${resultId}`);
}

export function getHeatExposureResultFactors(
  resultId: string,
): Promise<readonly HeatExposureFactorValue[]> {
  return getJson<readonly HeatExposureFactorValue[]>(
    `/api/heat-exposure-results/${resultId}/factors`,
  );
}

export function heatExposureResultsCsvExportUrl(runId?: string): string {
  return exportUrl('/api/heat-exposure-results/export', { format: 'csv', runId });
}
