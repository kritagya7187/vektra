import {
  buildingsCsvExportUrl,
  buildingsGeoJsonExportUrl,
  simulationRunsCsvExportUrl,
} from '../api';
import { h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

/**
 * Export Actions. Plain downloads against the backend's real export
 * endpoints — no client-side file generation; Content-Disposition:
 * attachment on those responses already makes a plain <a href> trigger a
 * native browser download.
 */
export function renderExportActions(container: HTMLElement, onClose: () => void): PanelController {
  const shell = createPanelShell({ id: 'export', title: 'Export', onClose });

  const link = (href: string, label: string): HTMLElement =>
    h('a', { class: 'export__link', href, download: true }, label);

  mount(
    shell.body,
    h(
      'ul',
      { class: 'export__list' },
      h('li', {}, link(buildingsCsvExportUrl(), 'Buildings (CSV)')),
      h('li', {}, link(buildingsGeoJsonExportUrl(), 'Buildings (GeoJSON)')),
      h('li', {}, link(simulationRunsCsvExportUrl(), 'Simulation runs (CSV)')),
    ),
  );

  mount(container, shell.element);
  shell.focus();

  return {
    destroy: (): void => {
      container.removeChild(shell.element);
    },
  };
}
