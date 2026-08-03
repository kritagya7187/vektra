import { Store } from './store';

/**
 * UI state: which overlay is open. Deliberately just an id, not a
 * boolean per panel — only one primary overlay is meaningfully open at a
 * time (progressive disclosure).
 *
 * Step 20 adds 'layerControl' (§6, a togglable panel like 'export') and
 * 'floodInspection' (§7, opened the same way 'inspection' already is —
 * via a map click, just for a flood-cell hit instead of a building hit).
 * Job status (§9) and the timeline (§4) are deliberately NOT panels —
 * they're persistent chrome (like the existing status-root/top bar),
 * always visible when relevant rather than something a user opens/closes.
 */
export type PanelId = 'inspection' | 'export' | 'layerControl' | 'floodInspection';

export interface UiState {
  readonly openPanel: PanelId | null;
  readonly provenanceOpenForId: string | null;
}

const initialState: UiState = {
  openPanel: null,
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
