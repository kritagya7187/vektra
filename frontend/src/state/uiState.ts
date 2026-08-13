import { Store } from './store';
export type PanelId =
  | 'inspection'
  | 'export'
  | 'layerControl'
  | 'floodInspection'
  | 'simulate'
  | 'cityRuns'
  | 'compare'
  | 'measure'
  | 'rainfall';
export interface UiState {
  readonly openPanel: PanelId | null;
  readonly provenanceOpenForId: string | null;
}
const initialState: UiState = {
  openPanel: 'rainfall',
  provenanceOpenForId: null,
};
export const uiStore = new Store<UiState>(initialState);
export function openPanel(panel: PanelId): void {
  uiStore.set((previous) => ({
    ...previous,
    openPanel: panel,
    provenanceOpenForId: null,
  }));
}
export function closePanel(): void {
  uiStore.set({ openPanel: null, provenanceOpenForId: null });
}
export function openProvenance(provenanceId: string): void {
  uiStore.set((previous) => ({ ...previous, provenanceOpenForId: provenanceId }));
}
export function closeProvenance(): void {
  uiStore.set((previous) => ({ ...previous, provenanceOpenForId: null }));
}
