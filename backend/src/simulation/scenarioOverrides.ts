import type { ScenarioOverride } from '../models';

/**
 * Pure, in-memory-only resolution of ScenarioOverride rows into a
 * per-building attribute map (EDD Section 15: "Overlays never modify
 * the layers they reference; they are resolved at simulation time").
 * No database access here — the caller already loaded the overrides via
 * ScenarioOverrideRepository.listByScenarioId(); this only reshapes them.
 *
 * attributeName/overrideValue are applied as opaque strings, with no
 * type coercion or validation: db/migrations/0011's own TODO states the
 * closed set of overridable attributes and their value types is "Not
 * specified in EDD Section 18/19/22... not invented here." Inventing
 * validation rules the EDD never specified would violate that same
 * principle just as much as inventing a factor equation would.
 *
 * IMPORTANT, disclosed honestly (see this subsystem's engineering
 * review): the resulting map is not currently consumed by
 * simulation/factors.ts's computeFactor — no presently-computable
 * factor (only meteorological_context, applied uniformly per building)
 * reads any building attribute at all, a direct consequence of Phase 2E's
 * own conservative "do not invent a combination method" decision for
 * morphology_density. Resolving overrides here is still real,
 * independently correct, and independently tested behavior — it is the
 * mechanism Section 15 requires, ready for the moment a future factor
 * genuinely reads a building attribute — it is simply inert with respect
 * to today's HeatExposureFactorValue output.
 */
export function resolveEffectiveAttributes(
  overrides: readonly ScenarioOverride[],
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const byBuilding = new Map<string, Map<string, string>>();

  for (const override of overrides) {
    const attributes = byBuilding.get(override.buildingId) ?? new Map<string, string>();
    attributes.set(override.attributeName, override.overrideValue);
    byBuilding.set(override.buildingId, attributes);
  }

  return byBuilding;
}
