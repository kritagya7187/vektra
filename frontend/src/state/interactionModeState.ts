import { Store } from './store';
export type InteractionMode =
  'explore' | 'simulate' | 'inspect' | 'measure' | 'layers' | 'compare' | 'cityRuns' | 'rainfall';
export interface InteractionModeState {
  readonly mode: InteractionMode;
}
export const interactionModeStore = new Store<InteractionModeState>({ mode: 'rainfall' });
export function setInteractionMode(mode: InteractionMode): void {
  interactionModeStore.set({ mode });
}
