import { scenarioStore, sceneStore, setStylingMode, viewScenario } from '../state';
import { formatTimestamp } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell, type PanelShellHandle } from './panelShell';
import type { PanelController } from './types';

/**
 * Scenario Comparison View (design review §4 item 7, §5D, FR-9). No
 * execution control exists here — if `scenarioResults` is null (the
 * API's own documented non-error state, ScenarioService.getComparison's
 * own comment), this renders the approved "Awaiting execution" state,
 * never an error and never a fabricated result.
 *
 * The baseline/scenario toggle sets scene state's `stylingMode`
 * (§5D: "a toggle on the SAME 3D scene", not a separate page) — main.ts
 * is what actually re-joins buildings against the chosen result set when
 * this changes; this panel only ever writes intent, never touches the
 * scene directly (layer separation, §9).
 */
export function renderComparisonView(container: HTMLElement, onClose: () => void): PanelController {
  const shell = createPanelShell({ id: 'comparison', title: 'Scenario comparison', onClose });
  mount(container, shell.element);
  shell.focus();

  const render = (): void => renderBody(shell);
  render();

  const unsubscribeScenario = scenarioStore.subscribe(render);
  const unsubscribeScene = sceneStore.subscribe(render);

  return {
    destroy: (): void => {
      unsubscribeScenario();
      unsubscribeScene();
      setStylingMode('baseline');
      container.removeChild(shell.element);
    },
  };
}

function renderBody(shell: PanelShellHandle): void {
  const { activeScenario, activeOverrides, comparison, comparisonStatus, comparisonError } =
    scenarioStore.get();
  const { stylingMode } = sceneStore.get();
  clear(shell.body);

  if (!activeScenario) {
    mount(shell.body, h('p', {}, 'Open a scenario from the Scenarios panel to compare it.'));
    return;
  }

  if (comparisonStatus === 'loading') {
    mount(shell.body, h('p', { role: 'status' }, 'Loading comparison…'));
    return;
  }
  if (comparisonStatus === 'error') {
    mount(
      shell.body,
      h(
        'p',
        { role: 'alert', class: 'comparison__error' },
        comparisonError?.message ?? 'Failed to load comparison.',
      ),
    );
    return;
  }
  if (!comparison) {
    return;
  }

  const header = h(
    'div',
    { class: 'comparison__header' },
    h('h3', {}, activeScenario.name),
    activeScenario.description
      ? h('p', { class: 'comparison__description' }, activeScenario.description)
      : null,
  );

  if (comparison.scenarioResults === null) {
    mount(
      shell.body,
      header,
      h(
        'div',
        { class: 'comparison__awaiting', role: 'status' },
        h('p', { class: 'comparison__awaiting-title' }, 'Awaiting execution'),
        h(
          'p',
          {},
          'This scenario has been defined but not yet run. Scenario execution happens outside this application, via the simulation engine — the frontend cannot trigger it.',
        ),
        h(
          'button',
          { type: 'button', onClick: () => void viewScenario(activeScenario.scenarioId) },
          'Check again',
        ),
      ),
      renderOverridesSummary(activeOverrides),
    );
    return;
  }

  const toggle = h(
    'div',
    { class: 'comparison__toggle', role: 'group', 'aria-label': 'Scene styling' },
    ...(['baseline', 'scenario'] as const).map((mode) =>
      h(
        'button',
        {
          type: 'button',
          class: `comparison__toggle-btn${stylingMode === mode ? ' comparison__toggle-btn--active' : ''}`,
          'aria-pressed': stylingMode === mode ? 'true' : 'false',
          onClick: () => setStylingMode(mode),
        },
        mode === 'baseline' ? 'View: Baseline' : 'View: Scenario',
      ),
    ),
  );

  const summary = h(
    'div',
    { class: 'comparison__summary' },
    h(
      'p',
      {},
      `${comparison.baselineResults.length} baseline result(s), ${comparison.scenarioResults.length} scenario result(s) — computed ${formatTimestamp(comparison.baselineResults[0]?.computedAt ?? activeScenario.createdAt)}.`,
    ),
    h(
      'p',
      { class: 'comparison__honesty-note' },
      'Baseline and scenario results are currently numerically identical: no presently-computable Heat Exposure Index factor reads any building attribute an override can change. See the Legend for which factors are computable today.',
    ),
  );

  mount(shell.body, header, toggle, summary, renderOverridesSummary(activeOverrides));
}

function renderOverridesSummary(
  overrides: readonly { attributeName: string; overrideValue: string; buildingId: string }[],
): HTMLElement {
  if (overrides.length === 0) {
    return h(
      'p',
      { class: 'comparison__overrides-note' },
      'This scenario’s override list is only available in the session where it was created or last opened.',
    );
  }
  return h(
    'div',
    { class: 'comparison__overrides' },
    h('h4', {}, 'Overrides applied'),
    h(
      'ul',
      {},
      ...overrides.map((o) =>
        h(
          'li',
          {},
          `${o.attributeName} = ${o.overrideValue} (building ${o.buildingId.slice(0, 8)}…)`,
        ),
      ),
    ),
  );
}
