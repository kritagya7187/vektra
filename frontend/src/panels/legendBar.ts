import {
  computeVisualizationRanges,
  ndviRampStops,
  thermalRampStops,
  type DataRange,
} from '../domain/colorRamps';
import { buildingStore, sceneStore } from '../state';
import { formatFactorKey, formatKelvinWithCelsius } from '../utils/formatting';
import { h, mount } from '../utils/dom';

const FACTOR_KEYS_IN_ORDER = [
  'thermal_signature',
  'vegetation_land_cover',
  'morphology_density',
  'exposure_shading',
  'meteorological_context',
] as const;

/**
 * Persistent, always-visible, compact legend bar (visualization
 * redesign) — replaces the old click-to-open Legend panel
 * (panels/legend.ts, now deleted). Reacts to sceneStore's
 * activeVisualizationMode and re-renders with the ramp + real data
 * range for whichever layer is active — never a generic legend that
 * doesn't match what's actually coloring the scene, since it reads the
 * exact same domain/colorRamps.ts stops the 3D scene itself uses.
 *
 * Placed bottom-center by main.ts, deliberately not bottom-left, so it
 * doesn't crowd the existing status toast there.
 */
function rampGradientCss(stops: readonly (readonly [number, string])[]): string {
  const parts = stops.map(([stop, color]) => `${color} ${stop * 100}%`);
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

function rangeLabel(range: DataRange, format: (value: number) => string): string {
  return `${format(range.min)} — ${format(range.max)}`;
}

function renderDefaultContent(): HTMLElement {
  return h(
    'div',
    { class: 'legend-bar__content' },
    h(
      'p',
      { class: 'legend-bar__status', role: 'status' },
      'Composite Heat Exposure Index: not yet computable.',
    ),
    h(
      'ul',
      { class: 'legend-bar__factors', 'aria-label': 'Heat Exposure Index factors' },
      ...FACTOR_KEYS_IN_ORDER.map((key) =>
        h(
          'li',
          { class: 'legend-bar__factor' },
          h('span', {}, formatFactorKey(key)),
          h(
            'span',
            {
              class: `legend-bar__factor-state legend-bar__factor-state--${key === 'meteorological_context' ? 'computable' : 'not-computable'}`,
            },
            key === 'meteorological_context' ? 'Computable' : 'Not computable',
          ),
        ),
      ),
    ),
  );
}

function renderRampContent(options: {
  readonly title: string;
  readonly subtitle: string;
  readonly stops: readonly (readonly [number, string])[];
  readonly range: DataRange | null;
  readonly formatValue: (value: number) => string;
  readonly note: string;
}): HTMLElement {
  if (!options.range) {
    return h(
      'div',
      { class: 'legend-bar__content' },
      h('p', { class: 'legend-bar__status' }, options.title),
      h(
        'p',
        { class: 'legend-bar__note' },
        'No computable values for this layer in the active run — every building would render as "no data."',
      ),
    );
  }
  return h(
    'div',
    { class: 'legend-bar__content' },
    h('p', { class: 'legend-bar__status' }, options.title),
    h('div', {
      class: 'legend-bar__ramp',
      style: `background: ${rampGradientCss(options.stops)}`,
    }),
    h(
      'div',
      { class: 'legend-bar__range' },
      h('span', {}, rangeLabel(options.range, options.formatValue)),
    ),
    h('p', { class: 'legend-bar__note' }, options.subtitle),
    h('p', { class: 'legend-bar__note' }, options.note),
  );
}

function renderLandCoverContent(): HTMLElement {
  return h(
    'div',
    { class: 'legend-bar__content' },
    h('p', { class: 'legend-bar__status' }, 'Land Cover'),
    h(
      'p',
      { class: 'legend-bar__note' },
      'ESA WorldCover is ingested and provenance-tracked, but not yet exposed as structured per-building data — this layer requires additional backend work before it can be visualized honestly.',
    ),
  );
}

export function renderLegendBar(container: HTMLElement): () => void {
  const render = (): void => {
    const { activeVisualizationMode } = sceneStore.get();
    const { twinBuildings } = buildingStore.get();
    const ranges = computeVisualizationRanges(twinBuildings);

    let content: HTMLElement;
    switch (activeVisualizationMode) {
      case 'thermal':
        content = renderRampContent({
          title: 'Surface Thermal Signature (Landsat ST_B10)',
          subtitle: 'Not measured air temperature — a real satellite surface reading.',
          stops: thermalRampStops(),
          range: ranges.thermal,
          formatValue: formatKelvinWithCelsius,
          note: 'Native resolution 30m — nearby small buildings may share one pixel value. Range shown is relative to this run’s real data, not a fixed scale.',
        });
        break;
      case 'ndvi':
        content = renderRampContent({
          title: 'Vegetation Index (NDVI)',
          subtitle: 'Higher = denser vegetation, from real Sentinel-2 reflectance.',
          stops: ndviRampStops(),
          range: ranges.ndvi,
          formatValue: (value) => value.toFixed(3),
          note: 'Range shown is relative to this run’s real observed data, not the full -1..1 theoretical scale.',
        });
        break;
      case 'landcover':
        content = renderLandCoverContent();
        break;
      case 'default':
      default:
        content = renderDefaultContent();
        break;
    }

    mount(container, h('div', { class: 'legend-bar', 'aria-label': 'Legend' }, content));
  };

  render();
  const unsubscribeScene = sceneStore.subscribe(render);
  const unsubscribeBuilding = buildingStore.subscribe(render);
  return (): void => {
    unsubscribeScene();
    unsubscribeBuilding();
  };
}
