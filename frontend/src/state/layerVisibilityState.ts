import { LAYER_IDS, type LayerId, type LayerVisibility } from '../domain/layers';
import { Store } from './store';
const initialState: LayerVisibility = {
  terrain: true,
  imagery: true,
  buildings3d: true,
  maxDepth: true,
  arrivalTime: false,
  duration: false,
  adminBoundary: true,
};
export const layerVisibilityStore = new Store<LayerVisibility>(initialState);
export function setLayerVisible(layer: LayerId, visible: boolean): void {
  layerVisibilityStore.set((previous) => ({ ...previous, [layer]: visible }));
}
export function toggleLayer(layer: LayerId): void {
  layerVisibilityStore.set((previous) => ({ ...previous, [layer]: !previous[layer] }));
}
export function showOnlyFloodMetric(layer: 'maxDepth' | 'arrivalTime' | 'duration'): void {
  const floodLayers: readonly ('maxDepth' | 'arrivalTime' | 'duration')[] = [
    'maxDepth',
    'arrivalTime',
    'duration',
  ];
  layerVisibilityStore.set((previous) => {
    const next = { ...previous };
    for (const id of floodLayers) {
      next[id] = id === layer;
    }
    return next;
  });
}
export { LAYER_IDS };
