import { runStore, type PanelId } from '../state';
import { formatRunStatus, formatTimestamp } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';

/**
 * Design review §4/§10: minimal, permanent chrome — app identity, the
 * active-run indicator, and entry points into the contextual overlays.
 * Nothing else lives here; this is deliberately not a navbar with menu
 * items, since the scene itself is the navigation surface.
 */
export function renderTopBar(
  container: HTMLElement,
  onOpenPanel: (panel: PanelId) => void,
): () => void {
  const render = (): void => {
    const { activeRun, status } = runStore.get();

    const runIndicator =
      status === 'loading'
        ? h('span', { class: 'topbar__run', role: 'status' }, 'Loading run…')
        : activeRun
          ? h(
              'span',
              { class: 'topbar__run' },
              `Baseline · ${formatRunStatus(activeRun.status)} · ${formatTimestamp(activeRun.createdAt)}`,
            )
          : h('span', { class: 'topbar__run topbar__run--empty' }, 'No completed baseline run yet');

    const nav = h(
      'nav',
      { class: 'topbar__actions', 'aria-label': 'Panels' },
      h('button', { type: 'button', onClick: () => onOpenPanel('scenarioWorkspace') }, 'Scenarios'),
      h('button', { type: 'button', onClick: () => onOpenPanel('export') }, 'Export'),
    );

    clear(container);
    mount(
      container,
      h(
        'header',
        { class: 'topbar' },
        h('span', { class: 'topbar__brand' }, 'VEKTRA'),
        runIndicator,
        nav,
      ),
    );
  };

  render();
  return runStore.subscribe(render);
}
