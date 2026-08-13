function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampIndex(index: number, max: number): number {
  return Math.min(Math.max(index, 0), max);
}

interface Corner {
  readonly value: number;
  readonly wet: boolean;
}

function cornerAt(grid: readonly (readonly number[])[], row: number, col: number): Corner {
  const value = grid[row][col];
  return { value, wet: value > 0 };
}

export function refineDepthGrid(grid: readonly (readonly number[])[], factor: number): number[][] {
  const height = grid.length;
  const width = height > 0 ? grid[0].length : 0;
  if (factor <= 1 || width === 0 || height === 0) {
    return grid.map((row) => [...row]);
  }

  const outHeight = height * factor;
  const outWidth = width * factor;
  const output: number[][] = [];

  for (let outRow = 0; outRow < outHeight; outRow += 1) {
    const srcY = (outRow + 0.5) / factor - 0.5;
    const rowLowRaw = Math.floor(srcY);
    const rowFrac = clamp01(srcY - rowLowRaw);
    const rowLow = clampIndex(rowLowRaw, height - 1);
    const rowHigh = clampIndex(rowLowRaw + 1, height - 1);

    const row: number[] = [];
    for (let outCol = 0; outCol < outWidth; outCol += 1) {
      const srcX = (outCol + 0.5) / factor - 0.5;
      const colLowRaw = Math.floor(srcX);
      const colFrac = clamp01(srcX - colLowRaw);
      const colLow = clampIndex(colLowRaw, width - 1);
      const colHigh = clampIndex(colLowRaw + 1, width - 1);

      const corners: readonly [Corner, number][] = [
        [cornerAt(grid, rowLow, colLow), (1 - rowFrac) * (1 - colFrac)],
        [cornerAt(grid, rowLow, colHigh), (1 - rowFrac) * colFrac],
        [cornerAt(grid, rowHigh, colLow), rowFrac * (1 - colFrac)],
        [cornerAt(grid, rowHigh, colHigh), rowFrac * colFrac],
      ];

      let weightedSum = 0;
      let weightTotal = 0;
      for (const [corner, weight] of corners) {
        if (corner.wet) {
          weightedSum += corner.value * weight;
          weightTotal += weight;
        }
      }
      row.push(weightTotal > 0 ? weightedSum / weightTotal : 0);
    }
    output.push(row);
  }

  return output;
}
