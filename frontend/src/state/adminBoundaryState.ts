import type { CityRunBoundary } from '../api';
import { Store } from './store';
export interface AdminBoundaryState {
  readonly boundary: CityRunBoundary | null;
}
export const adminBoundaryStore = new Store<AdminBoundaryState>({ boundary: null });
export function setAdminBoundary(boundary: CityRunBoundary | null): void {
  adminBoundaryStore.set({ boundary });
}
