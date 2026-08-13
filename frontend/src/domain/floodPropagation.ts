export function depthAtTime(
  maxDepthGrid: readonly (readonly number[])[],
  arrivalTimeGrid: readonly (readonly (number | null)[])[],
  tMinutes: number,
): number[][] {
  return maxDepthGrid.map((row, rowIndex) =>
    row.map((maxDepth, colIndex) => {
      const arrival = arrivalTimeGrid[rowIndex]?.[colIndex] ?? null;
      if (arrival === null || arrival > tMinutes) {
        return 0;
      }
      return maxDepth;
    }),
  );
}

export function maxArrivalMinutes(
  arrivalTimeGrid: readonly (readonly (number | null)[])[],
): number {
  let max = 0;
  for (const row of arrivalTimeGrid) {
    for (const value of row) {
      if (value !== null && Number.isFinite(value) && value > max) {
        max = value;
      }
    }
  }
  return max;
}
