import {
  closePanel,
  interactionModeStore,
  openPanel,
  setInteractionMode,
  type InteractionMode,
  type PanelId,
} from '../state';
import { button } from '../ui/primitives';
import type { IconName } from '../ui/icons';
import { clear, h, mount } from '../utils/dom';

interface ModeEntry {
  readonly mode: InteractionMode;
  readonly icon: IconName;
  readonly label: string;
  readonly panel: PanelId | null;
}

const MODES: readonly ModeEntry[] = [
  { mode: 'rainfall', icon: 'rainfall', label: 'Rainfall', panel: 'rainfall' },
  { mode: 'explore', icon: 'explore', label: 'Explore', panel: null },
  { mode: 'simulate', icon: 'simulate', label: 'Simulate', panel: 'simulate' },
  { mode: 'inspect', icon: 'inspect', label: 'Inspect', panel: null },
  { mode: 'measure', icon: 'measure', label: 'Measure', panel: 'measure' },
  { mode: 'layers', icon: 'layers', label: 'Layers', panel: 'layerControl' },
  { mode: 'compare', icon: 'compare', label: 'Compare', panel: 'compare' },
  { mode: 'cityRuns', icon: 'cityRuns', label: 'City runs', panel: 'cityRuns' },
];

export interface InstrumentRailActions {
  readonly onResetCamera: () => void;
  readonly onFitAoi: () => void;
  readonly onFitBuildings: () => void;
}

export function renderInstrumentRail(
  container: HTMLElement,
  actions: InstrumentRailActions,
): () => void {
  const render = (): void => {
    const { mode } = interactionModeStore.get();
    clear(container);
    mount(
      container,
      h(
        'div',
        { class: 'rail' },
        h(
          'div',
          { class: 'rail__group' },
          ...MODES.map((entry) =>
            button({
              iconName: entry.icon,
              title: entry.label,
              ariaLabel: entry.label,
              active: mode === entry.mode,
              onClick: () => {
                setInteractionMode(entry.mode);
                if (entry.panel) {
                  openPanel(entry.panel);
                } else {
                  closePanel();
                }
              },
            }),
          ),
          button({
            iconName: 'download',
            title: 'Export',
            ariaLabel: 'Export',
            onClick: () => openPanel('export'),
          }),
        ),
        h(
          'div',
          { class: 'rail__group' },
          button({
            iconName: 'resetCamera',
            title: 'Reset camera',
            ariaLabel: 'Reset camera',
            onClick: actions.onResetCamera,
          }),
          button({
            iconName: 'fitAoi',
            title: 'Fit to AOI',
            ariaLabel: 'Fit to AOI',
            onClick: actions.onFitAoi,
          }),
          button({
            iconName: 'fitBuildings',
            title: 'Fit to buildings',
            ariaLabel: 'Fit to buildings',
            onClick: actions.onFitBuildings,
          }),
        ),
      ),
    );
  };
  render();
  return interactionModeStore.subscribe(render);
}
