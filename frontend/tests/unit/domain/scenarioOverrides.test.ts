import { describe, expect, it } from 'vitest';
import { groupOverridesByBuilding } from '../../../src/domain/scenarioOverrides';
import type { ScenarioOverride } from '../../../src/api';

function override(overrides: Partial<ScenarioOverride> = {}): ScenarioOverride {
  return {
    overrideId: 'o1',
    scenarioId: 's1',
    buildingId: 'b1',
    sequenceNumber: 0,
    attributeName: 'roof_albedo',
    overrideValue: '0.8',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('groupOverridesByBuilding', () => {
  it('returns an empty map for an empty list', () => {
    expect(groupOverridesByBuilding([]).size).toBe(0);
  });

  it('groups multiple overrides for the same building under one key', () => {
    const grouped = groupOverridesByBuilding([
      override({ overrideId: 'o1', buildingId: 'b1', attributeName: 'roof_albedo' }),
      override({ overrideId: 'o2', buildingId: 'b1', attributeName: 'vegetation_context' }),
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get('b1')).toHaveLength(2);
  });

  it('keeps different buildings separate', () => {
    const grouped = groupOverridesByBuilding([
      override({ overrideId: 'o1', buildingId: 'b1' }),
      override({ overrideId: 'o2', buildingId: 'b2' }),
    ]);
    expect(grouped.size).toBe(2);
  });
});
