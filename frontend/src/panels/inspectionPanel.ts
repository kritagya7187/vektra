import { buildingStore, uiStore, closeProvenance, openProvenance } from '../state';
import { formatNullableNumber, formatNullableText } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell, type PanelShellHandle } from './panelShell';
import { renderProvenanceInspector } from './provenanceInspector';
import type { PanelController } from './types';
export function renderInspectionPanel(
  container: HTMLElement,
  onClose: () => void,
): PanelController {
  const shell = createPanelShell({ id: 'inspection', title: 'Building', onClose });
  mount(container, shell.element);
  shell.focus();
  const render = (): void => renderBody(shell);
  render();
  const unsubBuilding = buildingStore.subscribe(render);
  const unsubUi = uiStore.subscribe(render);
  return {
    destroy: (): void => {
      unsubBuilding();
      unsubUi();
      closeProvenance();
      container.removeChild(shell.element);
    },
  };
}
function renderBody(shell: PanelShellHandle): void {
  const { selection } = buildingStore.get();
  const ui = uiStore.get();
  clear(shell.body);
  if (selection.status === 'loading') {
    mount(shell.body, h('p', { role: 'status' }, 'Loading building…'));
    return;
  }
  if (selection.status === 'error') {
    mount(
      shell.body,
      h(
        'p',
        { role: 'alert', class: 'inspection__error' },
        selection.error?.message ?? 'Failed to load building.',
      ),
    );
    return;
  }
  if (selection.status === 'idle' || !selection.building) {
    mount(shell.body, h('p', {}, 'Select a building in the scene to inspect it.'));
    return;
  }
  const building = selection.building;
  const attributes = h(
    'dl',
    { class: 'inspection__attributes' },
    h('dt', {}, 'Name'),
    h('dd', {}, formatNullableText(building.name)),
    h('dt', {}, 'Building type'),
    h('dd', {}, formatNullableText(building.buildingTagType)),
    h('dt', {}, 'OSM id'),
    h('dd', {}, `${building.osmId} (${building.osmType})`),
    h('dt', {}, 'Height'),
    h('dd', {}, formatNullableNumber(building.heightM, 'm')),
    h('dt', {}, 'Levels'),
    h('dd', {}, formatNullableNumber(building.buildingLevels)),
    h('dt', {}, 'Footprint area'),
    h('dd', {}, formatNullableNumber(building.footprintAreaSqm, 'm²')),
  );
  const provenanceToggle = h(
    'button',
    {
      class: 'inspection__toggle',
      type: 'button',
      'aria-expanded': ui.provenanceOpenForId === building.provenanceId ? 'true' : 'false',
      onClick: () =>
        ui.provenanceOpenForId === building.provenanceId
          ? closeProvenance()
          : openProvenance(building.provenanceId),
    },
    ui.provenanceOpenForId === building.provenanceId ? 'Hide provenance' : 'Show provenance',
  );
  const provenanceContainer = h('div', { class: 'inspection__provenance' });
  mount(shell.body, attributes, provenanceToggle, provenanceContainer);
  if (ui.provenanceOpenForId === building.provenanceId) {
    renderProvenanceInspector(provenanceContainer, building.provenanceId);
  }
}
