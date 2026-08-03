import { cancelActiveFloodRun, floodRunStore, submitDemoFloodSimulation } from '../state';
import { formatRunStatus } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';

/**
 * Step 20 §5/§9: persistent chrome, not a togglable panel (like
 * topbar-root/status-root already are) — the job-submission trigger and
 * its live loading/processing/completed/failed status, always visible
 * rather than something a user opens and closes. Houses the labeled
 * demo-submission action (AskUserQuestion, this step; see
 * domain/demoScenario.ts for why "Submit" isn't a real scenario picker).
 */
export function renderJobStatusPanel(container: HTMLElement): () => void {
  const render = (): void => {
    const { status, activeRun, error } = floodRunStore.get();
    clear(container);

    const submitButton = h(
      'button',
      {
        type: 'button',
        class: 'job-status__submit',
        disabled:
          status === 'loading' || (activeRun !== null && !isTerminalStatus(activeRun.status)),
        onClick: () => void submitDemoFloodSimulation(),
      },
      'Run Demo Flood Simulation',
    );

    const children: (HTMLElement | string | null)[] = [submitButton];

    if (status === 'loading' && !activeRun) {
      children.push(h('p', { role: 'status' }, 'Submitting…'));
    }

    if (activeRun) {
      children.push(
        h(
          'p',
          { role: 'status', class: `job-status__state job-status__state--${activeRun.status}` },
          `Run ${activeRun.runId.slice(0, 8)} · ${formatRunStatus(activeRun.status)}`,
        ),
      );
      if (activeRun.status === 'pending') {
        children.push(
          h('button', { type: 'button', onClick: () => void cancelActiveFloodRun() }, 'Cancel'),
        );
      }
      if (activeRun.status === 'failed' && activeRun.errorMessage) {
        children.push(h('p', { role: 'alert' }, activeRun.errorMessage));
      }
    }

    if (error) {
      children.push(h('p', { role: 'alert' }, error.message));
    }

    mount(container, h('div', { class: 'job-status' }, ...children));
  };

  render();
  return floodRunStore.subscribe(render);
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
