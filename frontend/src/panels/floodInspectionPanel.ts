import { floodInspectionStore } from '../state';
import { formatNullableNumber } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

const COORDINATE_PRECISION = 5;

function formatCoordinate(value: number): string {
  return value.toFixed(COORDINATE_PRECISION);
}

/**
 * Step 20 §7 (Feature Inspection): click anywhere on the map (that
 * didn't hit a building) -> coordinates + max depth + arrival time +
 * duration, read directly from the already-fetched summary
 * (state/floodInspectionState.ts does the lookup, this panel only
 * displays it). No exposure/damage computation, matching the spec's own
 * explicit boundary.
 */
export function renderFloodInspectionPanel(
  container: HTMLElement,
  onClose: () => void,
): PanelController {
  const shell = createPanelShell({ id: 'flood-inspection', title: 'Flood inspection', onClose });
  mount(container, shell.element);
  shell.focus();

  const render = (): void => {
    const point = floodInspectionStore.get();
    clear(shell.body);

    if (!point) {
      mount(shell.body, h('p', {}, 'Click the map to inspect a point.'));
      return;
    }

    mount(
      shell.body,
      h(
        'dl',
        { class: 'flood-inspection__attributes' },
        h('dt', {}, 'Longitude'),
        h('dd', {}, formatCoordinate(point.lon)),
        h('dt', {}, 'Latitude'),
        h('dd', {}, formatCoordinate(point.lat)),
        h('dt', {}, 'Max depth'),
        h('dd', {}, formatNullableNumber(point.maxDepthM, 'm')),
        h('dt', {}, 'Arrival time'),
        h('dd', {}, formatNullableNumber(point.arrivalTimeMin, 'min')),
        h('dt', {}, 'Duration above threshold'),
        h('dd', {}, formatNullableNumber(point.durationMin, 'min')),
      ),
    );
  };
  render();

  const unsubscribe = floodInspectionStore.subscribe(render);

  return {
    destroy: (): void => {
      unsubscribe();
      container.removeChild(shell.element);
    },
  };
}
