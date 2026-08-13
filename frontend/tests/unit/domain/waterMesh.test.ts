import { describe, expect, it } from 'vitest';
import { buildWaterMesh } from '../../../src/domain/waterMesh';
import type { AoiBoundsWgs84 } from '../../../src/api';

const AOI: AoiBoundsWgs84 = [0, 0, 2, 2];

describe('buildWaterMesh', () => {
  it('emits one cell per positive-depth grid entry, skipping dry cells', () => {
    const grid = [
      [1, 0],
      [0, 2],
    ];
    const cells = buildWaterMesh(grid, AOI);
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.depth).sort()).toEqual([1, 2]);
  });

  it('returns an empty mesh for an all-dry grid', () => {
    expect(buildWaterMesh([[0, 0]], AOI)).toEqual([]);
  });

  it('returns an empty mesh for an empty grid', () => {
    expect(buildWaterMesh([], AOI)).toEqual([]);
  });

  it('places each cell polygon within the AOI bounds', () => {
    const grid = [
      [1, 1],
      [1, 1],
    ];
    const cells = buildWaterMesh(grid, AOI);
    for (const cell of cells) {
      for (const [lon, lat] of cell.polygon) {
        expect(lon).toBeGreaterThanOrEqual(0);
        expect(lon).toBeLessThanOrEqual(2);
        expect(lat).toBeGreaterThanOrEqual(0);
        expect(lat).toBeLessThanOrEqual(2);
      }
    }
  });

  it('produces a closed quad (4 distinct corners) per cell', () => {
    const cells = buildWaterMesh([[1]], AOI);
    expect(cells[0].polygon).toHaveLength(4);
    const unique = new Set(cells[0].polygon.map((p) => p.join(',')));
    expect(unique.size).toBe(4);
  });
});
