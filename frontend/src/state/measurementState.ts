import { Store } from './store';
import type { LonLat } from '../domain/measurement';
export interface MeasurementState {
  readonly points: readonly LonLat[];
}
export const measurementStore = new Store<MeasurementState>({ points: [] });
export function addMeasurementPoint(point: LonLat): void {
  measurementStore.set((previous) => ({ points: [...previous.points, point] }));
}
export function undoMeasurementPoint(): void {
  measurementStore.set((previous) => ({ points: previous.points.slice(0, -1) }));
}
export function clearMeasurement(): void {
  measurementStore.set({ points: [] });
}
