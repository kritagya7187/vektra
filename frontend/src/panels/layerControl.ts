import type { VisualizationMode } from '../domain/colorRamps';
import { sceneStore, setVisualizationMode } from '../state';
import { h, mount } from '../utils/dom';

/**
 * Persistent, always-visible left-floating layer-mode switcher
 * (visualization redesign). Kept structurally separate from the
 * click-to-open overlay panel rotation (panelHost.ts) — which data
 * layer colors the scene should always be one click away, not buried
 * behind whichever panel happens to be open.
 *
 * 'landcover' is shown, not hidden, but disabled with an honest reason:
 * consistent with this app's own established "never hide a limitation,
 * explain it" pattern (see the factor breakdown's "Not computable"
 * badges) — see domain/colorRamps.ts's own header comment for why no
 * ramp exists for it yet.
 */
const MODES: readonly {
  readonly mode: VisualizationMode;
  readonly label: string;
  readonly disabledReason?: string;
}[] = [
  { mode: 'default', label: 'Default' },
  { mode: 'thermal', label: 'Thermal' },
  { mode: 'ndvi', label: 'NDVI' },
  {
    mode: 'landcover',
    label: 'Land Cover',
    disabledReason:
      'Requires additional backend work — ESA WorldCover is not yet exposed as structured per-building data.',
  },
];

export function renderLayerControl(container: HTMLElement): () => void {
  const render = (): void => {
    const { activeVisualizationMode } = sceneStore.get();

    const buttons = MODES.map(({ mode, label, disabledReason }) =>
      h(
        'button',
        {
          type: 'button',
          class: `layer-control__btn${mode === activeVisualizationMode ? ' layer-control__btn--active' : ''}`,
          disabled: disabledReason !== undefined,
          title: disabledReason,
          'aria-pressed': String(mode === activeVisualizationMode),
          onClick: disabledReason ? undefined : (): void => setVisualizationMode(mode),
        },
        label,
      ),
    );

    mount(
      container,
      h(
        'nav',
        { class: 'layer-control', 'aria-label': 'Visualization layer' },
        h('span', { class: 'layer-control__title' }, 'Layer'),
        ...buttons,
      ),
    );
  };

  render();
  return sceneStore.subscribe(render);
}
