import { beforeEach, describe, expect, it } from 'vitest';
import {
  addMeasurementPoint,
  clearMeasurement,
  measurementStore,
  undoMeasurementPoint,
} from '../../../src/state/measurementState';

beforeEach(() => {
  clearMeasurement();
});

describe('addMeasurementPoint', () => {
  it('appends points in order', () => {
    addMeasurementPoint([0, 0]);
    addMeasurementPoint([1, 1]);
    expect(measurementStore.get().points).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe('undoMeasurementPoint', () => {
  it('removes exactly the last point', () => {
    addMeasurementPoint([0, 0]);
    addMeasurementPoint([1, 1]);
    undoMeasurementPoint();
    expect(measurementStore.get().points).toEqual([[0, 0]]);
  });
  it('is a no-op on an empty path', () => {
    undoMeasurementPoint();
    expect(measurementStore.get().points).toEqual([]);
  });
});

describe('clearMeasurement', () => {
  it('removes every point', () => {
    addMeasurementPoint([0, 0]);
    addMeasurementPoint([1, 1]);
    clearMeasurement();
    expect(measurementStore.get().points).toEqual([]);
  });
});
