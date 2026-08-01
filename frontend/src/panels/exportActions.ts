import {
  buildingsCsvExportUrl,
  buildingsGeoJsonExportUrl,
  heatExposureResultsCsvExportUrl,
  scenariosCsvExportUrl,
  simulationRunsCsvExportUrl,
} from '../api';
import { runStore } from '../state';
import { h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

/**
 * Export Actions (design review §4 item 8, FR-13, EDD Section 21:
 * "Export services (CSV, GeoJSON) for the above"). Plain downloads
 * against the backend's real export endpoints — no client-side file
 * generation; Content-Disposition: attachment on those responses
 * (export/sendExport.ts) already makes a plain <a href> trigger a native
 * browser download.
 */
export function renderExportActions(container: HTMLElement, onClose: () => void): PanelController {
  const shell = createPanelShell({ id: 'export', title: 'Export', onClose });

  const { activeRun } = runStore.get();

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
      h(
        'li',
        {},
        link(
          heatExposureResultsCsvExportUrl(activeRun?.runId),
          activeRun
            ? 'Heat Exposure results — active run (CSV)'
            : 'Heat Exposure results — all (CSV)',
        ),
      ),
      h('li', {}, link(scenariosCsvExportUrl(), 'Scenarios (CSV)')),
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
