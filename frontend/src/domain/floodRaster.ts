import type { AoiBoundsWgs84 } from '../api';
import type { Rgba } from './colormap';

/**
 * Step 20: turns one of flood-engine's real per-cell summary grids
 * (Step 14's max-depth/arrival-time/duration-above-threshold rasters,
 * fetched via the summary endpoint already built in Step 19/20 Part 0b)
 * into a flat RGBA byte buffer a deck.gl BitmapLayer can render directly
 * -- pure array math, no interpolation, smoothing, or recomputation of
 * any underlying value (the scientific-boundary rule this step's own
 * spec states explicitly).
 *
 * Row/column convention: row 0 of the grid is assumed to be the
 * northernmost row (standard row-major raster convention, matching
 * numpy/flood-engine's own array layout) -- so row 0 becomes the TOP row
 * of the output image, consistent with BitmapLayer's own `bounds`
 * prop taking [west, south, east, north] while presenting `image` with
 * row 0 at the top. Not independently verified against a real rendered
 * map in this environment (no live browser here) -- flagged in Step 20's
 * freeze audit as something to visually confirm once real data is available.
 */

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

/** The real maximum finite value present in a grid -- 0 for an all-null/all-zero/empty grid, never fabricated. */
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

/**
 * Step 20 §7 (Feature Inspection): reads the value already present at
 * the grid cell containing (lon, lat) -- a pure lookup, never an
 * interpolation between cells or a recomputation of the underlying
 * value. Null when the point falls outside the run's own AOI bounds,
 * or the grid is empty.
 */
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
  // Row 0 is the northernmost row (see this module's own docstring), so
  // latitude decreases as row increases -- the same orientation used to
  // build the raster image in the first place.
  const row = Math.min(Math.floor(((north - lat) / (north - south)) * height), height - 1);

  return grid[row][col];
}
