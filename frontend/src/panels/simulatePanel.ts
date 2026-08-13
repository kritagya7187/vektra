import { cancelActiveFloodRun, floodRunStore, submitDemoFloodSimulation } from '../state';
import { button, disclosure, statusPill } from '../ui/primitives';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import { renderSimulationSummaryCard } from './simulationSummaryCard';
import type { PanelController } from './types';

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function renderSimulatePanel(container: HTMLElement, onClose: () => void): PanelController {
  const shell = createPanelShell({ id: 'simulate', title: 'Simulate', onClose });
  mount(container, shell.element);
  shell.focus();

  let alphaOverride: number | undefined;
  let timeMaxdtOverride: number | undefined;

  const advancedBody = h(
    'div',
    { class: 'simulate__advanced' },
    h(
      'label',
      { class: 'simulate__field' },
      h('span', {}, 'Adaptive-timestep safety factor (alpha)'),
      h('input', {
        type: 'number',
        step: '0.05',
        min: '0.05',
        max: '1',
        placeholder: '0.5 (default)',
        onInput: (event: Event) => {
          const value = (event.target as HTMLInputElement).value;
          alphaOverride = value === '' ? undefined : Number(value);
        },
      }),
    ),
    h(
      'label',
      { class: 'simulate__field' },
      h('span', {}, 'Max timestep (s)'),
      h('input', {
        type: 'number',
        step: '1',
        min: '1',
        placeholder: '60 (default)',
        onInput: (event: Event) => {
          const value = (event.target as HTMLInputElement).value;
          timeMaxdtOverride = value === '' ? undefined : Number(value);
        },
      }),
    ),
  );
  const advanced = disclosure({ label: 'Advanced solver parameters', body: advancedBody });

  const summaryContainer = h('div', {});
  const summaryDestroy = renderSimulationSummaryCard(summaryContainer);

  const render = (): void => {
    const { status, activeRun, error } = floodRunStore.get();
    const busy =
      status === 'loading' || (activeRun !== null && !isTerminalStatus(activeRun.status));

    const actions = h(
      'div',
      { class: 'simulate__actions' },
      button({
        label: 'Run demo simulation',
        variant: 'primary',
        disabled: busy,
        onClick: () =>
          void submitDemoFloodSimulation({
            solverParameters:
              alphaOverride !== undefined || timeMaxdtOverride !== undefined
                ? { alpha: alphaOverride, timeMaxdtS: timeMaxdtOverride }
                : undefined,
          }),
      }),
      activeRun && activeRun.status === 'pending'
        ? button({ label: 'Cancel', variant: 'ghost', onClick: () => void cancelActiveFloodRun() })
        : null,
    );

    const statusRow = activeRun
      ? h('div', { class: 'simulate__status' }, statusPill(activeRun.status))
      : null;

    const errorRow =
      error || (activeRun?.status === 'failed' && activeRun.errorMessage)
        ? h('p', { role: 'alert' }, error?.message ?? activeRun?.errorMessage ?? '')
        : null;

    const details = activeRun
      ? disclosure({
          label: 'Run details',
          body: h(
            'dl',
            { class: 'inspection__attributes' },
            h('dt', {}, 'Run id'),
            h('dd', {}, activeRun.runId),
            h('dt', {}, 'Scenario'),
            h('dd', {}, activeRun.scenarioId),
            h('dt', {}, 'Created'),
            h('dd', {}, activeRun.createdAt),
            activeRun.startedAt ? h('dt', {}, 'Started') : null,
            activeRun.startedAt ? h('dd', {}, activeRun.startedAt) : null,
            activeRun.completedAt ? h('dt', {}, 'Completed') : null,
            activeRun.completedAt ? h('dd', {}, activeRun.completedAt) : null,
          ),
        }).element
      : null;

    clear(shell.body);
    mount(shell.body, actions, statusRow, errorRow, advanced.element, summaryContainer, details);
  };

  render();
  const unsubscribe = floodRunStore.subscribe(render);
  return {
    destroy: (): void => {
      unsubscribe();
      summaryDestroy();
      container.removeChild(shell.element);
    },
  };
}
