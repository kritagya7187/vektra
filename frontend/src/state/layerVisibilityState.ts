import { LAYER_IDS, type LayerId, type LayerVisibility } from '../domain/layers';
import { Store } from './store';

/** Step 20 §6: independent toggles for terrain/imagery/3D buildings/flood depth/arrival time/duration — the single source of truth scene/twinScene.ts renders from (see domain/layers.ts). */

const initialState: LayerVisibility = {
  terrain: true,
  imagery: true,
  buildings3d: true,
  maxDepth: true,
  arrivalTime: false,
  duration: false,
};

export const layerVisibilityStore = new Store<LayerVisibility>(initialState);

export function setLayerVisible(layer: LayerId, visible: boolean): void {
  layerVisibilityStore.set((previous) => ({ ...previous, [layer]: visible }));
}

export function toggleLayer(layer: LayerId): void {
  layerVisibilityStore.set((previous) => ({ ...previous, [layer]: !previous[layer] }));
}

/** Exactly one of the three flood-metric layers visible, the rest off — the timeline's own "which frame is showing" operation, reusing this same store rather than a parallel visibility concept. */
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
