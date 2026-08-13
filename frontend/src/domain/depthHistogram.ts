export interface DepthBin {
  readonly label: string;
  readonly minM: number;
  readonly maxM: number | null;
  readonly cellCount: number;
}

const BIN_EDGES: readonly number[] = [0, 0.1, 0.5, 1, 2, 3, 4];

function labelFor(minM: number, maxM: number | null): string {
  return maxM === null ? `${minM}+` : `${minM}–${maxM}`;
}

export function computeDepthHistogram(grid: readonly (readonly number[])[]): DepthBin[] {
  const bins: DepthBin[] = BIN_EDGES.map((minM, index) => ({
    label: labelFor(minM, BIN_EDGES[index + 1] ?? null),
    minM,
    maxM: BIN_EDGES[index + 1] ?? null,
    cellCount: 0,
  }));

  for (const row of grid) {
    for (const value of row) {
      if (!Number.isFinite(value) || value <= 0) {
        continue;
      }
      let binIndex = bins.length - 1;
      for (let i = 0; i < BIN_EDGES.length - 1; i += 1) {
        if (value >= BIN_EDGES[i] && value < BIN_EDGES[i + 1]) {
          binIndex = i;
          break;
        }
      }
      bins[binIndex] = { ...bins[binIndex], cellCount: bins[binIndex].cellCount + 1 };
    }
  }

  return bins;
}
