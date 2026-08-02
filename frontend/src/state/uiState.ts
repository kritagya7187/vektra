import { Store } from './store';

/**
 * UI state (design review §8): which overlay is open and at what
 * disclosure depth (§3's "Depth 0-3" model). Deliberately just an id,
 * not a boolean per panel — only one primary overlay is meaningfully
 * open at a time (progressive disclosure, §11), matching the approved
 * "opening the Scenario Workspace collapses the Inspection Panel" rule.
 *
 * 'legend' was removed from this rotation by the visualization redesign:
 * the legend is now a persistent, always-visible bar (panels/legendBar.ts,
 * mounted directly by main.ts) rather than a click-to-open overlay,
 * since it must stay in sync with whichever data layer currently colors
 * the scene — hiding it behind a click would contradict that.
 */
export type PanelId = 'inspection' | 'scenarioWorkspace' | 'comparison' | 'export';

export interface UiState {
  readonly openPanel: PanelId | null;
  readonly factorBreakdownExpanded: boolean;
  readonly provenanceOpenForId: string | null;
}

const initialState: UiState = {
  openPanel: null,
  factorBreakdownExpanded: false,
  provenanceOpenForId: null,
};

export const uiStore = new Store<UiState>(initialState);

export function openPanel(panel: PanelId): void {
  uiStore.set((previous) => ({
    ...previous,
    openPanel: panel,
    // Leaving one panel context closes deeper disclosure levels opened
    // under it — re-opening starts back at the summary depth.
    factorBreakdownExpanded: panel === 'inspection' ? previous.factorBreakdownExpanded : false,
    provenanceOpenForId: null,
  }));
}

export function closePanel(): void {
  uiStore.set({ openPanel: null, factorBreakdownExpanded: false, provenanceOpenForId: null });
}

export function setFactorBreakdownExpanded(expanded: boolean): void {
  uiStore.set((previous) => ({ ...previous, factorBreakdownExpanded: expanded }));
}

export function openProvenance(provenanceId: string): void {
  uiStore.set((previous) => ({ ...previous, provenanceOpenForId: provenanceId }));
}

export function closeProvenance(): void {
  uiStore.set((previous) => ({ ...previous, provenanceOpenForId: null }));
}
