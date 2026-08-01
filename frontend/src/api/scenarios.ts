import { exportUrl, getJson, postJson } from './client';
import type {
  CreateScenarioRequest,
  Scenario,
  ScenarioComparison,
  ScenarioWithOverrides,
} from './types';

/**
 * GET/POST /scenarios, GET /:id, GET /:id/comparison —
 * backend/src/api/routes/scenarios.ts exactly. There is deliberately no
 * function here to re-fetch a scenario's ScenarioOverride rows after
 * creation, execute a scenario, or edit an already-created scenario —
 * none of those endpoints exist (ScenarioController's own comment: "No
 * execution/trigger endpoint"). See design review §7/§16 for how the
 * one-time override payload from createScenario() is retained instead.
 */

export function listScenariosPage(limit: number, offset: number): Promise<readonly Scenario[]> {
  return getJson<readonly Scenario[]>('/api/scenarios', {
    limit: String(limit),
    offset: String(offset),
  });
}

export function getScenario(scenarioId: string): Promise<Scenario> {
  return getJson<Scenario>(`/api/scenarios/${scenarioId}`);
}

export function createScenario(request: CreateScenarioRequest): Promise<ScenarioWithOverrides> {
  return postJson<ScenarioWithOverrides>('/api/scenarios', request);
}

export function getScenarioComparison(scenarioId: string): Promise<ScenarioComparison> {
  return getJson<ScenarioComparison>(`/api/scenarios/${scenarioId}/comparison`);
}

export function scenariosCsvExportUrl(): string {
  return exportUrl('/api/scenarios/export', { format: 'csv' });
}
