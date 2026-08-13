import { floodRunStore } from '../state';
import { statusPill } from '../ui/primitives';
import { clear, h, mount } from '../utils/dom';

function elapsedLabel(createdAt: string): string {
  const elapsedS = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (elapsedS < 60) {
    return `${elapsedS}s`;
  }
  return `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s`;
}

export function renderJobStatusPanel(container: HTMLElement): () => void {
  const render = (): void => {
    const { status, activeRun } = floodRunStore.get();
    clear(container);
    if (status === 'loading' && !activeRun) {
      mount(container, h('div', { class: 'job-status' }, h('p', { role: 'status' }, 'Submitting…')));
      return;
    }
    if (!activeRun) {
      mount(
        container,
        h('div', { class: 'job-status' }, h('p', { class: 'job-status__state' }, 'No active run')),
      );
      return;
    }
    mount(
      container,
      h(
        'div',
        { class: 'job-status' },
        statusPill(activeRun.status),
        h('p', { class: 'job-status__state' }, elapsedLabel(activeRun.createdAt)),
      ),
    );
  };
  render();
  return floodRunStore.subscribe(render);
}
