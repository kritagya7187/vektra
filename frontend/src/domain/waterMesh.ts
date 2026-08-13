import type { AoiBoundsWgs84 } from '../api';

export interface WaterCell {
  readonly polygon: readonly (readonly [number, number])[];
  readonly depth: number;
}

export function buildWaterMesh(
  grid: readonly (readonly number[])[],
  aoiBoundsWgs84: AoiBoundsWgs84,
): readonly WaterCell[] {
  const height = grid.length;
  const width = height > 0 ? grid[0].length : 0;
  if (width === 0 || height === 0) {
    return [];
  }

  const [west, south, east, north] = aoiBoundsWgs84;
  const cellWidth = (east - west) / width;
  const cellHeight = (north - south) / height;
  const cells: WaterCell[] = [];

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const depth = grid[row][col];
      if (depth <= 0) {
        continue;
      }
      const cellWest = west + col * cellWidth;
      const cellEast = cellWest + cellWidth;
      const cellNorth = north - row * cellHeight;
      const cellSouth = cellNorth - cellHeight;
      cells.push({
        polygon: [
          [cellWest, cellSouth],
          [cellEast, cellSouth],
          [cellEast, cellNorth],
          [cellWest, cellNorth],
        ],
        depth,
      });
    }
  }

  return cells;
}
