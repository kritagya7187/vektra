import type { VisualizationMode } from '../domain/colorRamps';
import { Store } from './store';

/**
 * Scene state (design review §8): the small amount of state the Cesium
 * viewer's own lifecycle exposes to the rest of the app — never the
 * inverse. The scene reads `stylingMode` to decide which result set
 * (baseline vs the active scenario's comparison results) currently
 * colors buildings (§5D's Comparison Mode, "a toggle on the SAME 3D
 * scene", not a separate page) and writes `ready` once, on Viewer
 * construction; it never subscribes to Run/Building/Scenario state
 * directly for anything beyond what main.ts wires explicitly.
 *
 * `activeVisualizationMode` (visualization redesign) is the independent
 * "which data layer colors the scene" choice (Default/Thermal/NDVI/Land
 * Cover) — orthogonal to `stylingMode`'s baseline-vs-scenario choice:
 * either result set can be viewed under any visualization mode.
 */
export type StylingMode = 'baseline' | 'scenario';

export interface SceneState {
  readonly ready: boolean;
  readonly stylingMode: StylingMode;
  readonly activeVisualizationMode: VisualizationMode;
}

const initialState: SceneState = {
  ready: false,
  stylingMode: 'baseline',
  activeVisualizationMode: 'default',
};

export const sceneStore = new Store<SceneState>(initialState);

export function setSceneReady(): void {
  sceneStore.set((previous) => ({ ...previous, ready: true }));
}

export function setStylingMode(mode: StylingMode): void {
  sceneStore.set((previous) => ({ ...previous, stylingMode: mode }));
}

export function setVisualizationMode(mode: VisualizationMode): void {
  sceneStore.set((previous) => ({ ...previous, activeVisualizationMode: mode }));
}
