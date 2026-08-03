import { Store } from './store';

/**
 * Scene state: the small amount of state the Cesium viewer's own
 * lifecycle exposes to the rest of the app — never the inverse. Writes
 * `ready` once, on Viewer construction; it never subscribes to
 * Run/Building state directly for anything beyond what main.ts wires
 * explicitly.
 */
export interface SceneState {
  readonly ready: boolean;
}

const initialState: SceneState = {
  ready: false,
};

export const sceneStore = new Store<SceneState>(initialState);

export function setSceneReady(): void {
  sceneStore.set((previous) => ({ ...previous, ready: true }));
}
