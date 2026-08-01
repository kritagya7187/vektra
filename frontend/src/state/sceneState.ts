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
 */
export type StylingMode = 'baseline' | 'scenario';

export interface SceneState {
  readonly ready: boolean;
  readonly stylingMode: StylingMode;
}

const initialState: SceneState = {
  ready: false,
  stylingMode: 'baseline',
};

export const sceneStore = new Store<SceneState>(initialState);

export function setSceneReady(): void {
  sceneStore.set((previous) => ({ ...previous, ready: true }));
}

export function setStylingMode(mode: StylingMode): void {
  sceneStore.set((previous) => ({ ...previous, stylingMode: mode }));
}
