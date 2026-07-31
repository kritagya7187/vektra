import { describe, expect, it } from 'vitest';
import {
  computeFactor,
  computeMeteorologicalContextFactor,
  type MeteorologicalReading,
} from '../../../src/simulation/factors';
import type { MeteorologicalObservation } from '../../../src/models';

const BASE_OBSERVATION: MeteorologicalObservation = {
  metObservationId: 'obs1',
  sourceCode: 'open_meteo',
  observationTimestamp: new Date('2025-06-01T12:00:00Z'),
  location: { type: 'Point', coordinates: [72.8317, 18.925] },
  variableName: 'temperature_2m',
  variableValue: 31.4,
  variableUnit: '°C',
  provenanceId: 'prov-met-1',
  createdAt: new Date('2025-06-01T12:05:00Z'),
  updatedAt: new Date('2025-06-01T12:05:00Z'),
};

describe('computeMeteorologicalContextFactor', () => {
  it('reports the raw observation value verbatim when a reading is provided', () => {
    const reading: MeteorologicalReading = {
      provenanceId: 'prov-met-1',
      observation: BASE_OBSERVATION,
    };
    const result = computeMeteorologicalContextFactor(reading);
    expect(result.isComputable).toBe(true);
    expect(result.factorValue).toBe(31.4);
    expect(result.notes).toContain('temperature_2m');
    expect(result.notes).toContain('°C');
  });

  it('marks not computable when no reading was resolved', () => {
    const result = computeMeteorologicalContextFactor(null);
    expect(result.isComputable).toBe(false);
    expect(result.factorValue).toBeNull();
  });

  it('applies the exact same raw value uniformly regardless of which building it is applied for (no per-building variation, no invented interpolation)', () => {
    const reading: MeteorologicalReading = {
      provenanceId: 'prov-met-1',
      observation: BASE_OBSERVATION,
    };
    const a = computeMeteorologicalContextFactor(reading);
    const b = computeMeteorologicalContextFactor(reading);
    expect(a.factorValue).toBe(b.factorValue);
  });
});

describe('computeFactor', () => {
  const notComputableFactors = [
    'thermal_signature',
    'vegetation_land_cover',
    'morphology_density',
    'exposure_shading',
  ] as const;

  it.each(notComputableFactors)(
    'always marks %s not computable with a non-empty explanatory note',
    (factorKey) => {
      const result = computeFactor(factorKey, null);
      expect(result.isComputable).toBe(false);
      expect(result.factorValue).toBeNull();
      expect(result.notes.length).toBeGreaterThan(0);
    },
  );

  it("morphology_density's note explains the EDD's own floor (area AND density) is unmet, not just that the full concept is incomplete", () => {
    const result = computeFactor('morphology_density', null);
    expect(result.notes).toContain('density');
    expect(result.notes.toLowerCase()).toContain('minimum');
  });

  it('is deterministic: identical inputs always produce identical output for every factor key', () => {
    const reading: MeteorologicalReading = {
      provenanceId: 'prov-met-1',
      observation: BASE_OBSERVATION,
    };
    const allKeys = [
      'thermal_signature',
      'vegetation_land_cover',
      'morphology_density',
      'exposure_shading',
      'meteorological_context',
    ] as const;
    for (const key of allKeys) {
      const first = computeFactor(key, reading);
      const second = computeFactor(key, reading);
      expect(second).toEqual(first);
    }
  });

  it('routes only meteorological_context to a computable implementation; every other factor is always not computable', () => {
    const reading: MeteorologicalReading = {
      provenanceId: 'prov-met-1',
      observation: BASE_OBSERVATION,
    };
    expect(computeFactor('meteorological_context', reading).isComputable).toBe(true);
    expect(computeFactor('morphology_density', reading).isComputable).toBe(false);
    expect(computeFactor('thermal_signature', reading).isComputable).toBe(false);
    expect(computeFactor('vegetation_land_cover', reading).isComputable).toBe(false);
    expect(computeFactor('exposure_shading', reading).isComputable).toBe(false);
  });
});
