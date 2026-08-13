import { closePanel, uiStore, type PanelId } from '../state';
import { h, mount as mountDom } from '../utils/dom';
import { renderExportActions } from './exportActions';
import { renderFloodInspectionPanel } from './floodInspectionPanel';
import { renderInspectionPanel } from './inspectionPanel';
import { renderLayerControlPanel } from './layerControlPanel';
import { renderRainfallCalendarPanel } from './rainfallCalendarPanel';
import type { PanelController } from './types';

export function createPanelHost(overlayRoot: HTMLElement): () => void {
  let current: PanelController | null = null;
  let lastPanel: PanelId | null = null;
  let mountToken = 0;
  const render = (): void => {
    const { openPanel } = uiStore.get();
    if (openPanel === lastPanel) {
      return;
    }
    lastPanel = openPanel;
    const token = ++mountToken;
    if (current) {
      current.destroy();
      current = null;
    }
    if (openPanel === null) {
      return;
    }
    const eager = mountEager(openPanel, overlayRoot);
    if (eager) {
      current = eager;
      return;
    }
    mountDom(overlayRoot, h('p', { role: 'status' }, 'Loading…'));
    void mountLazy(openPanel, overlayRoot).then((controller) => {
      if (token !== mountToken) {
        controller.destroy();
        return;
      }
      current = controller;
    });
  };
  render();
  return uiStore.subscribe(render);
}

function mountEager(panel: PanelId, overlayRoot: HTMLElement): PanelController | null {
  switch (panel) {
    case 'inspection':
      return renderInspectionPanel(overlayRoot, closePanel);
    case 'export':
      return renderExportActions(overlayRoot, closePanel);
    case 'layerControl':
      return renderLayerControlPanel(overlayRoot, closePanel);
    case 'floodInspection':
      return renderFloodInspectionPanel(overlayRoot, closePanel);
    case 'rainfall':
      return renderRainfallCalendarPanel(overlayRoot, closePanel);
    case 'simulate':
    case 'cityRuns':
    case 'compare':
    case 'measure':
      return null;
  }
}

async function mountLazy(panel: PanelId, overlayRoot: HTMLElement): Promise<PanelController> {
  switch (panel) {
    case 'simulate':
      return (await import('./simulatePanel')).renderSimulatePanel(overlayRoot, closePanel);
    case 'cityRuns':
      return (await import('./cityRunPanel')).renderCityRunPanel(overlayRoot, closePanel);
    case 'compare':
      return (await import('./comparePanel')).renderComparePanel(overlayRoot, closePanel);
    case 'measure':
      return (await import('./measurePanel')).renderMeasurePanel(overlayRoot, closePanel);
    default:
      throw new Error(`No lazy panel registered for ${panel}`);
  }
}
