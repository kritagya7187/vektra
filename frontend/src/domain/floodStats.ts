import type { AoiBoundsWgs84, FloodOutputSummary } from '../api';
import { gridMax } from './floodRaster';
import { haversineMeters } from './geo';
export interface FloodStats {
  readonly floodedAreaSqKm: number;
  readonly floodedFraction: number;
  readonly maxDepthM: number;
  readonly maxArrivalMin: number;
  readonly maxDurationMin: number;
  readonly stepCount: number;
  readonly simulatedDurationS: number;
  readonly rainfallInputM3: number;
  readonly infiltrationLossM3: number;
  readonly boundaryOutflowM3: number;
}
const SQ_METERS_PER_SQ_KM = 1000000;
export function computeFloodStats(
  summary: FloodOutputSummary,
  aoiBoundsWgs84: AoiBoundsWgs84,
): FloodStats {
  const [west, south, east, north] = aoiBoundsWgs84;
  const midLat = (south + north) / 2;
  const widthM = haversineMeters(midLat, west, midLat, east);
  const heightM = haversineMeters(south, west, north, west);
  const grid = summary.maxDepthM;
  const height = grid.length;
  const width = height > 0 ? grid[0].length : 0;
  const totalCells = width * height;
  const cellAreaSqM = totalCells > 0 ? (widthM * heightM) / totalCells : 0;
  let floodedCells = 0;
  for (const row of grid) {
    for (const value of row) {
      if (value > 0) {
        floodedCells += 1;
      }
    }
  }
  return {
    floodedAreaSqKm: (floodedCells * cellAreaSqM) / SQ_METERS_PER_SQ_KM,
    floodedFraction: totalCells > 0 ? floodedCells / totalCells : 0,
    maxDepthM: gridMax(summary.maxDepthM),
    maxArrivalMin: gridMax(summary.arrivalTimeMin),
    maxDurationMin: gridMax(summary.durationAboveThresholdMin),
    stepCount: summary.stepCount,
    simulatedDurationS: summary.simulatedDurationS,
    rainfallInputM3: summary.massLedger.rainfallInputM3,
    infiltrationLossM3: summary.massLedger.infiltrationLossM3,
    boundaryOutflowM3: summary.massLedger.boundaryOutflowM3,
  };
}
