import { describe, expect, it } from 'vitest';
import { refineDepthGrid } from '../../../src/domain/floodMeshRefinement';

describe('refineDepthGrid', () => {
  it("returns the grid unchanged at factor 1 (identity, matches today's behavior)", () => {
    const grid = [
      [1, 2],
      [3, 4],
    ];
    expect(refineDepthGrid(grid, 1)).toEqual(grid);
  });

  it('produces exactly factor-times the original dimensions', () => {
    const grid = [
      [0, 0, 0],
      [0, 5, 0],
      [0, 0, 0],
    ];
    const refined = refineDepthGrid(grid, 2);
    expect(refined.length).toBe(6);
    expect(refined[0].length).toBe(6);
  });

  it('interpolates smoothly across a fully wet region', () => {
    const grid = [
      [1, 3],
      [1, 3],
    ];
    const refined = refineDepthGrid(grid, 2);
    const row = refined[1];
    expect(row).toEqual([1, 1.5, 2.5, 3]);
    for (let i = 1; i < row.length; i += 1) {
      expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);
    }
  });

  it('does not bleed phantom depth into cells far from any wet original cell', () => {
    const grid = [
      [0, 0, 0],
      [0, 5, 0],
      [0, 0, 0],
    ];
    const refined = refineDepthGrid(grid, 2);
    expect(refined[0][0]).toBe(0);
    expect(refined[0][5]).toBe(0);
    expect(refined[5][0]).toBe(0);
    expect(refined[5][5]).toBe(0);
  });

  it('returns the exact original value near a single wet cell (wet-only averaging, not diluted by dry neighbors)', () => {
    const grid = [
      [0, 0, 0],
      [0, 5, 0],
      [0, 0, 0],
    ];
    const refined = refineDepthGrid(grid, 2);
    expect(refined[2][2]).toBe(5);
  });

  it('clamps at grid edges without crashing on a single-cell grid', () => {
    const grid = [[7]];
    const refined = refineDepthGrid(grid, 3);
    expect(refined.length).toBe(3);
    expect(refined[0].length).toBe(3);
    for (const row of refined) {
      for (const value of row) {
        expect(value).toBeCloseTo(7);
      }
    }
  });
});
