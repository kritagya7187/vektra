import { layerVisibilityStore, toggleLayer } from '../state';
import type { LayerId } from '../domain/layers';
import { chip } from '../ui/primitives';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';
const LAYER_LABELS: Record<LayerId, string> = {
  terrain: 'Terrain',
  imagery: 'Base imagery',
  buildings3d: '3D buildings',
  maxDepth: 'Flood depth',
  arrivalTime: 'Arrival time',
  duration: 'Duration above threshold',
  adminBoundary: 'Admin boundary',
};
const GROUPS: readonly { readonly label: string; readonly layers: readonly LayerId[] }[] = [
  { label: 'Base', layers: ['terrain', 'imagery'] },
  { label: 'Twin', layers: ['buildings3d'] },
  { label: 'Flood', layers: ['maxDepth', 'arrivalTime', 'duration'] },
  { label: 'Context', layers: ['adminBoundary'] },
];
export function renderLayerControlPanel(
  container: HTMLElement,
  onClose: () => void,
): PanelController {
  const shell = createPanelShell({ id: 'layer-control', title: 'Layers', onClose });
  mount(container, shell.element);
  shell.focus();
  const render = (): void => {
    const visibility = layerVisibilityStore.get();
    clear(shell.body);
    mount(
      shell.body,
      ...GROUPS.map((group) =>
        h(
          'div',
          { class: 'layer-control__group' },
          h('span', { class: 'layer-control__group-label' }, group.label),
          h(
            'ul',
            { class: 'layer-control__list' },
            ...group.layers.map((layer) =>
              h(
                'li',
                {},
                chip({
                  label: LAYER_LABELS[layer],
                  active: visibility[layer],
                  onClick: () => toggleLayer(layer),
                }),
              ),
            ),
          ),
        ),
      ),
    );
  };
  render();
  const unsubscribe = layerVisibilityStore.subscribe(render);
  return {
    destroy: (): void => {
      unsubscribe();
      container.removeChild(shell.element);
    },
  };
}
