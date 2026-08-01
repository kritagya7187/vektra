import type { ScenarioOverride } from '../api';

/**
 * Display-side grouping of a scenario's override rows by building —
 * mirrors the shape (not the code) of the backend's own
 * resolveEffectiveAttributes (simulation/scenarioOverrides.ts), which
 * performs the equivalent grouping server-side for its own, separate
 * purpose. This one has no simulation involvement; it exists purely so
 * the Scenario Workspace can render "what was changed" grouped by
 * building, from the ScenarioWithOverrides payload returned once by
 * POST /scenarios (design review §7's documented one-time-availability
 * caveat).
 */
export function groupOverridesByBuilding(
  overrides: readonly ScenarioOverride[],
): ReadonlyMap<string, readonly ScenarioOverride[]> {
  const byBuilding = new Map<string, ScenarioOverride[]>();
  for (const override of overrides) {
    const forBuilding = byBuilding.get(override.buildingId) ?? [];
    forBuilding.push(override);
    byBuilding.set(override.buildingId, forBuilding);
  }
  return byBuilding;
}
