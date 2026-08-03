import { layerVisibilityStore, toggleLayer } from '../state';
import type { LayerId } from '../domain/layers';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

/** Step 20 §6: independent checkboxes for terrain/imagery/3D buildings/flood depth/arrival time/duration — each one only ever toggles its own layer, never another. */

const LAYER_LABELS: Record<LayerId, string> = {
  terrain: 'Terrain',
  imagery: 'Base imagery',
  buildings3d: '3D buildings (Google Photorealistic)',
  maxDepth: 'Flood — max depth',
  arrivalTime: 'Flood — arrival time',
  duration: 'Flood — duration above threshold',
};

const LAYER_ORDER: readonly LayerId[] = [
  'terrain',
  'imagery',
  'buildings3d',
  'maxDepth',
  'arrivalTime',
  'duration',
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
      h(
        'ul',
        { class: 'layer-control__list' },
        ...LAYER_ORDER.map((layer) =>
          h(
            'li',
            {},
            h(
              'label',
              { class: 'layer-control__item' },
              h('input', {
                type: 'checkbox',
                checked: visibility[layer],
                onChange: () => toggleLayer(layer),
              }),
              LAYER_LABELS[layer],
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
