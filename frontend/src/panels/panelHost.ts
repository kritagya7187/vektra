import { closePanel, uiStore, type PanelId } from '../state';
import { renderCityRunPanel } from './cityRunPanel';
import { renderComparePanel } from './comparePanel';
import { renderExportActions } from './exportActions';
import { renderFloodInspectionPanel } from './floodInspectionPanel';
import { renderInspectionPanel } from './inspectionPanel';
import { renderLayerControlPanel } from './layerControlPanel';
import { renderMeasurePanel } from './measurePanel';
import { renderRainfallCalendarPanel } from './rainfallCalendarPanel';
import { renderSimulatePanel } from './simulatePanel';
import type { PanelController } from './types';
export function createPanelHost(overlayRoot: HTMLElement): () => void {
  let current: PanelController | null = null;
  let lastPanel: PanelId | null = null;
  const render = (): void => {
    const { openPanel } = uiStore.get();
    if (openPanel === lastPanel) {
      return;
    }
    lastPanel = openPanel;
    if (current) {
      current.destroy();
      current = null;
    }
    if (openPanel === null) {
      return;
    }
    current = mount(openPanel, overlayRoot);
  };
  render();
  return uiStore.subscribe(render);
}
function mount(panel: PanelId, overlayRoot: HTMLElement): PanelController {
  switch (panel) {
    case 'inspection':
      return renderInspectionPanel(overlayRoot, closePanel);
    case 'export':
      return renderExportActions(overlayRoot, closePanel);
    case 'layerControl':
      return renderLayerControlPanel(overlayRoot, closePanel);
    case 'floodInspection':
      return renderFloodInspectionPanel(overlayRoot, closePanel);
    case 'simulate':
      return renderSimulatePanel(overlayRoot, closePanel);
    case 'cityRuns':
      return renderCityRunPanel(overlayRoot, closePanel);
    case 'compare':
      return renderComparePanel(overlayRoot, closePanel);
    case 'measure':
      return renderMeasurePanel(overlayRoot, closePanel);
    case 'rainfall':
      return renderRainfallCalendarPanel(overlayRoot, closePanel);
  }
}
