import { closePanel, uiStore, type PanelId } from '../state';
import { renderComparisonView } from './comparisonView';
import { renderExportActions } from './exportActions';
import { renderInspectionPanel } from './inspectionPanel';
import { renderLegend } from './legend';
import { renderScenarioWorkspace } from './scenarioWorkspace';
import type { PanelController } from './types';

/**
 * Mounts exactly the overlay panel named by uiStore.openPanel, replacing
 * whatever was open before it (progressive disclosure, §3: "only one
 * primary overlay is meaningfully open at a time"). Reacts ONLY to
 * openPanel transitions — uiStore's other fields (factorBreakdownExpanded,
 * provenanceOpenForId) are each panel's own internal concern, already
 * handled by that panel's own subscription; destroying and recreating
 * the whole panel on every such change would both be wasteful and would
 * fight the panel's own internal re-render logic.
 */
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
    case 'legend':
      return renderLegend(overlayRoot, closePanel);
    case 'inspection':
      return renderInspectionPanel(overlayRoot, closePanel);
    case 'scenarioWorkspace':
      return renderScenarioWorkspace(overlayRoot, closePanel);
    case 'comparison':
      return renderComparisonView(overlayRoot, closePanel);
    case 'export':
      return renderExportActions(overlayRoot, closePanel);
  }
}
