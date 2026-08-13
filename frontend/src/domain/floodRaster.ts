import type { AoiBoundsWgs84 } from '../api';
import type { Rgba } from './colormap';
export interface RasterImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}
const RGBA_CHANNEL_COUNT = 4;
export function rasterizeGrid(
  grid: readonly (readonly (number | null)[])[],
  colorFor: (value: number | null) => Rgba,
): RasterImage {
  const height = grid.length;
  const width = height > 0 ? grid[0].length : 0;
  const data = new Uint8ClampedArray(width * height * RGBA_CHANNEL_COUNT);
  for (let row = 0; row < height; row += 1) {
    const gridRow = grid[row];
    for (let col = 0; col < width; col += 1) {
      const [r, g, b, a] = colorFor(gridRow[col]);
      const offset = (row * width + col) * RGBA_CHANNEL_COUNT;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { data, width, height };
}
export function gridMax(grid: readonly (readonly (number | null)[])[]): number {
  let max = 0;
  for (const row of grid) {
    for (const value of row) {
      if (value !== null && Number.isFinite(value) && value > max) {
        max = value;
      }
    }
  }
  return max;
}
export function sampleGridAt(
  grid: readonly (readonly (number | null)[])[],
  aoiBoundsWgs84: AoiBoundsWgs84,
  lon: number,
  lat: number,
): number | null {
  const height = grid.length;
  const width = height > 0 ? grid[0].length : 0;
  if (width === 0 || height === 0) {
    return null;
  }
  const [west, south, east, north] = aoiBoundsWgs84;
  if (lon < west || lon > east || lat < south || lat > north) {
    return null;
  }
  const col = Math.min(Math.floor(((lon - west) / (east - west)) * width), width - 1);
  const row = Math.min(Math.floor(((north - lat) / (north - south)) * height), height - 1);
  return grid[row][col];
}
