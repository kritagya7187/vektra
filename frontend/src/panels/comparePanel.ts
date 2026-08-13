import { ApiError, getCityRun, listCityRuns } from '../api';
import type { CityRunSummary } from '../api';
import { formatUnknown } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

const KPI_KEYS: readonly { readonly key: string; readonly label: string; readonly unit: string }[] =
  [
    { key: 'max_depth_m_city', label: 'Max depth', unit: 'm' },
    { key: 'wet_area_m2', label: 'Wet area', unit: 'm²' },
    { key: 'wet_cell_count', label: 'Wet cells', unit: '' },
    { key: 'tile_count', label: 'Tiles', unit: '' },
    { key: 'unknown_terrain_cell_count', label: 'Excluded terrain cells', unit: '' },
  ];

function runSelect(
  runs: readonly CityRunSummary[],
  onChange: (runId: string) => void,
): HTMLElement {
  return h(
    'select',
    { onChange: (event: Event) => onChange((event.target as HTMLSelectElement).value) },
    h('option', { value: '' }, 'Select a run…'),
    ...runs.map((run) => h('option', { value: run.runId }, run.runId)),
  );
}

async function renderComparison(
  container: HTMLElement,
  runIdA: string,
  runIdB: string,
): Promise<void> {
  mount(container, h('p', { role: 'status' }, 'Loading comparison…'));
  try {
    const [a, b] = await Promise.all([getCityRun(runIdA), getCityRun(runIdB)]);
    const summaryA = a.runSummary ?? {};
    const summaryB = b.runSummary ?? {};
    mount(
      container,
      h(
        'table',
        { class: 'compare__table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'KPI'), h('th', {}, runIdA), h('th', {}, runIdB))),
        h(
          'tbody',
          {},
          ...KPI_KEYS.map(({ key, label, unit }) =>
            h(
              'tr',
              {},
              h('td', {}, label),
              h('td', {}, `${formatUnknown(summaryA[key])} ${unit}`.trim()),
              h('td', {}, `${formatUnknown(summaryB[key])} ${unit}`.trim()),
            ),
          ),
        ),
      ),
    );
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Failed to load comparison.';
    mount(container, h('p', { role: 'alert' }, message));
  }
}

export function renderComparePanel(container: HTMLElement, onClose: () => void): PanelController {
  const shell = createPanelShell({ id: 'compare', title: 'Compare runs', onClose });
  mount(container, shell.element);
  shell.focus();
  mount(shell.body, h('p', { role: 'status' }, 'Loading city-scale runs…'));

  let runIdA = '';
  let runIdB = '';
  const resultContainer = h('div', { class: 'compare__result' });

  void listCityRuns()
    .then((runs) => {
      const maybeCompare = (): void => {
        if (runIdA && runIdB) {
          void renderComparison(resultContainer, runIdA, runIdB);
        }
      };
      clear(shell.body);
      mount(
        shell.body,
        h(
          'div',
          { class: 'compare__pickers' },
          runSelect(runs, (id) => {
            runIdA = id;
            maybeCompare();
          }),
          runSelect(runs, (id) => {
            runIdB = id;
            maybeCompare();
          }),
        ),
        resultContainer,
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof ApiError ? err.message : 'Failed to load city-scale runs.';
      mount(shell.body, h('p', { role: 'alert' }, message));
    });

  return {
    destroy: (): void => {
      clear(shell.body);
      container.removeChild(shell.element);
    },
  };
}
