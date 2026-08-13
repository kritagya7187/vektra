import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFloodInspection,
  floodInspectionStore,
  inspectFloodPoint,
} from '../../../src/state/floodInspectionState';
import { floodRunStore } from '../../../src/state/floodRunState';
beforeEach(() => {
  floodInspectionStore.set(null);
  floodRunStore.set({ status: 'idle', activeRun: null, summary: null, error: null });
});
describe('inspectFloodPoint', () => {
  it('records coordinates with null values when no summary is loaded yet', () => {
    inspectFloodPoint(72.85, 18.95);
    expect(floodInspectionStore.get()).toEqual({
      lon: 72.85,
      lat: 18.95,
      maxDepthM: null,
      arrivalTimeMin: null,
      durationMin: null,
    });
  });
  it('samples the real, already-loaded summary grids at the clicked point', () => {
    floodRunStore.set((previous) => ({
      ...previous,
      activeRun: {
        runId: 'r1',
        scenarioId: 'demo',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        errorMessage: null,
        aoiBoundsWgs84: [0, 0, 2, 2],
      },
      summary: {
        maxDepthM: [
          [1, 2],
          [3, 4],
        ],
        arrivalTimeMin: [
          [null, 5],
          [10, 20],
        ],
        durationAboveThresholdMin: [
          [0, 1],
          [2, 3],
        ],
        massLedger: { rainfallInputM3: 1, infiltrationLossM3: 0, boundaryOutflowM3: 0 },
        stepCount: 1,
        simulatedDurationS: 1,
      },
    }));
    inspectFloodPoint(0.1, 1.9);
    expect(floodInspectionStore.get()).toEqual({
      lon: 0.1,
      lat: 1.9,
      maxDepthM: 1,
      arrivalTimeMin: null,
      durationMin: 0,
    });
  });
});
describe('clearFloodInspection', () => {
  it('resets the store to null', () => {
    inspectFloodPoint(1, 1);
    clearFloodInspection();
    expect(floodInspectionStore.get()).toBeNull();
  });
});
