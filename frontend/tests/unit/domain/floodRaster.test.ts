import { describe, expect, it } from 'vitest';
import { gridMax, rasterizeGrid, sampleGridAt } from '../../../src/domain/floodRaster';
import type { AoiBoundsWgs84 } from '../../../src/api';

describe('rasterizeGrid', () => {
  it('produces a width*height*4 RGBA buffer', () => {
    const grid = [
      [1, 2],
      [3, 4],
    ];
    const image = rasterizeGrid(grid, () => [10, 20, 30, 40]);
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(image.data.length).toBe(2 * 2 * 4);
  });

  it('places row 0 first in the output buffer (top row), matching the raster convention documented in the module', () => {
    const grid = [[1], [2]];
    const image = rasterizeGrid(grid, (value) =>
      value === 1 ? [255, 0, 0, 255] : [0, 255, 0, 255],
    );
    // First 4 bytes = row 0 = red; next 4 bytes = row 1 = green.
    expect([image.data[0], image.data[1], image.data[2], image.data[3]]).toEqual([255, 0, 0, 255]);
    expect([image.data[4], image.data[5], image.data[6], image.data[7]]).toEqual([0, 255, 0, 255]);
  });

  it('returns an empty image for an empty grid', () => {
    const image = rasterizeGrid([], () => [0, 0, 0, 0]);
    expect(image.width).toBe(0);
    expect(image.height).toBe(0);
    expect(image.data.length).toBe(0);
  });

  it('passes null cells through to the color function unchanged', () => {
    const seen: (number | null)[] = [];
    rasterizeGrid([[1, null]], (value) => {
      seen.push(value);
      return [0, 0, 0, 0];
    });
    expect(seen).toEqual([1, null]);
  });
});

describe('gridMax', () => {
  it('finds the real maximum, ignoring null cells', () => {
    expect(
      gridMax([
        [1, null, 3],
        [2, 5, null],
      ]),
    ).toBe(5);
  });

  it('returns 0 for an all-null grid', () => {
    expect(gridMax([[null, null]])).toBe(0);
  });

  it('returns 0 for an empty grid', () => {
    expect(gridMax([])).toBe(0);
  });

  it('ignores non-finite values', () => {
    expect(gridMax([[NaN, Infinity, 2]])).toBe(2);
  });
});

describe('sampleGridAt', () => {
  const bounds: AoiBoundsWgs84 = [0, 0, 2, 2]; // west, south, east, north
  const grid = [
    [10, 20], // row 0 = north
    [30, 40], // row 1 = south
  ];

  it('samples the northwest cell for a point near the northwest corner', () => {
    expect(sampleGridAt(grid, bounds, 0.1, 1.9)).toBe(10);
  });

  it('samples the southeast cell for a point near the southeast corner', () => {
    expect(sampleGridAt(grid, bounds, 1.9, 0.1)).toBe(40);
  });

  it('returns null for a point outside the AOI bounds', () => {
    expect(sampleGridAt(grid, bounds, -1, 1)).toBeNull();
    expect(sampleGridAt(grid, bounds, 1, 5)).toBeNull();
  });

  it('returns null for an empty grid', () => {
    expect(sampleGridAt([], bounds, 1, 1)).toBeNull();
  });

  it('preserves a null cell value exactly (never coerced to a number)', () => {
    const gridWithNull = [
      [null, 20],
      [30, 40],
    ];
    expect(sampleGridAt(gridWithNull, bounds, 0.1, 1.9)).toBeNull();
  });
});
