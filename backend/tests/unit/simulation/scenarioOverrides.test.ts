import { describe, expect, it } from 'vitest';
import { resolveEffectiveAttributes } from '../../../src/simulation/scenarioOverrides';
import type { ScenarioOverride } from '../../../src/models';

function override(overrides: Partial<ScenarioOverride> = {}): ScenarioOverride {
  return {
    overrideId: 'override-1',
    scenarioId: 'scenario-1',
    buildingId: 'building-1',
    sequenceNumber: 0,
    attributeName: 'roof_albedo',
    overrideValue: '0.8',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('resolveEffectiveAttributes', () => {
  it('returns an empty map for an empty override list', () => {
    const result = resolveEffectiveAttributes([]);
    expect(result.size).toBe(0);
  });

  it('groups a single override under its building id', () => {
    const result = resolveEffectiveAttributes([
      override({ buildingId: 'b1', attributeName: 'roof_albedo', overrideValue: '0.8' }),
    ]);
    expect(result.size).toBe(1);
    expect(result.get('b1')?.get('roof_albedo')).toBe('0.8');
  });

  it('groups multiple attributes for the same building into one entry', () => {
    const result = resolveEffectiveAttributes([
      override({
        overrideId: 'o1',
        buildingId: 'b1',
        attributeName: 'roof_albedo',
        overrideValue: '0.8',
      }),
      override({
        overrideId: 'o2',
        buildingId: 'b1',
        attributeName: 'vegetation_context',
        overrideValue: 'tree_cover',
      }),
    ]);
    expect(result.size).toBe(1);
    const b1 = result.get('b1');
    expect(b1?.size).toBe(2);
    expect(b1?.get('roof_albedo')).toBe('0.8');
    expect(b1?.get('vegetation_context')).toBe('tree_cover');
  });

  it('keeps different buildings in separate entries', () => {
    const result = resolveEffectiveAttributes([
      override({
        overrideId: 'o1',
        buildingId: 'b1',
        attributeName: 'roof_albedo',
        overrideValue: '0.8',
      }),
      override({
        overrideId: 'o2',
        buildingId: 'b2',
        attributeName: 'roof_albedo',
        overrideValue: '0.3',
      }),
    ]);
    expect(result.size).toBe(2);
    expect(result.get('b1')?.get('roof_albedo')).toBe('0.8');
    expect(result.get('b2')?.get('roof_albedo')).toBe('0.3');
  });

  it('applies attribute_name/override_value as opaque strings — no type coercion or validation', () => {
    const result = resolveEffectiveAttributes([
      override({ attributeName: 'height_m', overrideValue: 'not-a-number' }),
    ]);
    // Deliberately still a string, not coerced to NaN or rejected — the
    // closed set of overridable attributes and their value types is Not
    // specified in the EDD (db/migrations/0011), so nothing is invented here.
    expect(result.get('building-1')?.get('height_m')).toBe('not-a-number');
    expect(typeof result.get('building-1')?.get('height_m')).toBe('string');
  });

  it('is deterministic: identical input always produces an equivalent map', () => {
    const overrides = [
      override({ overrideId: 'o1', buildingId: 'b1', attributeName: 'a', overrideValue: '1' }),
      override({ overrideId: 'o2', buildingId: 'b2', attributeName: 'b', overrideValue: '2' }),
    ];
    const first = resolveEffectiveAttributes(overrides);
    const second = resolveEffectiveAttributes(overrides);
    expect([...first.entries()].map(([k, v]) => [k, [...v.entries()]])).toEqual(
      [...second.entries()].map(([k, v]) => [k, [...v.entries()]]),
    );
  });
});
