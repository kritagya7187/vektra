import { runStore } from '../state';
import { formatRunStatus, formatTimestamp } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';
export function renderTopBar(container: HTMLElement): () => void {
  const render = (): void => {
    const { activeRun, status } = runStore.get();
    const runIndicator =
      status === 'loading'
        ? h('span', { class: 'topbar__run', role: 'status' }, 'Loading building twin…')
        : activeRun
          ? h(
              'span',
              { class: 'topbar__run' },
              `Baseline · ${formatRunStatus(activeRun.status)} · ${formatTimestamp(activeRun.createdAt)}`,
            )
          : h('span', { class: 'topbar__run topbar__run--empty' }, 'No baseline run');
    clear(container);
    mount(
      container,
      h(
        'header',
        { class: 'topbar' },
        h(
          'div',
          { class: 'topbar__identity' },
          h('span', { class: 'topbar__brand' }, 'VEKTRA'),
          h('span', { class: 'topbar__subtitle' }, 'Urban Flood Digital Twin · Mumbai'),
        ),
        runIndicator,
      ),
    );
  };
  render();
  return runStore.subscribe(render);
}
