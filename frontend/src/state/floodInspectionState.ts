import { sampleGridAt } from '../domain/floodRaster';
import { floodRunStore } from './floodRunState';
import { Store } from './store';

/**
 * Step 20 §7: the currently-inspected map point — coordinates plus
 * whatever the already-fetched summary grids say at that exact cell (a
 * lookup, not a computation; null values are preserved exactly, e.g. an
 * arrival time that was never reached). Populated by main.ts's map-click
 * routing (a non-building click), read by panels/floodInspectionPanel.ts.
 */
export interface FloodInspectionState {
  readonly lon: number;
  readonly lat: number;
  readonly maxDepthM: number | null;
  readonly arrivalTimeMin: number | null;
  readonly durationMin: number | null;
}

export const floodInspectionStore = new Store<FloodInspectionState | null>(null);

export function inspectFloodPoint(lon: number, lat: number): void {
  const { summary, activeRun } = floodRunStore.get();
  const aoiBoundsWgs84 = activeRun?.aoiBoundsWgs84;

  if (!summary || !aoiBoundsWgs84) {
    floodInspectionStore.set({
      lon,
      lat,
      maxDepthM: null,
      arrivalTimeMin: null,
      durationMin: null,
    });
    return;
  }

  floodInspectionStore.set({
    lon,
    lat,
    maxDepthM: sampleGridAt(summary.maxDepthM, aoiBoundsWgs84, lon, lat),
    arrivalTimeMin: sampleGridAt(summary.arrivalTimeMin, aoiBoundsWgs84, lon, lat),
    durationMin: sampleGridAt(summary.durationAboveThresholdMin, aoiBoundsWgs84, lon, lat),
  });
}

export function clearFloodInspection(): void {
  floodInspectionStore.set(null);
}
