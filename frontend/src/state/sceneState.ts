import { Store } from './store';
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
