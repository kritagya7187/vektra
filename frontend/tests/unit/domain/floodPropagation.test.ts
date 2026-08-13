import { describe, expect, it } from 'vitest';
import { depthAtTime, maxArrivalMinutes } from '../../../src/domain/floodPropagation';

describe('depthAtTime', () => {
  const maxDepth = [
    [1, 2],
    [3, 4],
  ];
  const arrival = [
    [5, 10],
    [null, 20],
  ];

  it('shows zero depth for cells that have not yet flooded at time T', () => {
    const result = depthAtTime(maxDepth, arrival, 4);
    expect(result).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
  it('shows real max depth once arrival time has passed', () => {
    const result = depthAtTime(maxDepth, arrival, 10);
    expect(result[0]).toEqual([1, 2]);
  });
  it('never floods a cell with null arrival time', () => {
    const result = depthAtTime(maxDepth, arrival, 1000);
    expect(result[1][0]).toBe(0);
  });
  it('floods every real-arrival cell once T exceeds every arrival time', () => {
    const result = depthAtTime(maxDepth, arrival, 1000);
    expect(result[0]).toEqual([1, 2]);
    expect(result[1][1]).toBe(4);
  });
});

describe('maxArrivalMinutes', () => {
  it('ignores null entries', () => {
    expect(
      maxArrivalMinutes([
        [5, null],
        [null, 20],
      ]),
    ).toBe(20);
  });
  it('returns zero for an all-null grid', () => {
    expect(maxArrivalMinutes([[null, null]])).toBe(0);
  });
});
