import { h } from '../utils/dom';

/**
 * Shared chrome for every overlay panel (design review §15
 * accessibility: keyboard operability and screen-reader accessible
 * overlay panels independent of 3D-canvas picking). Each panel is a
 * real, focusable `role="dialog"` region — not a div soup — with a
 * labelled heading, a close control reachable by keyboard, and Escape
 * wired to the same close behavior as the visible close button.
 */
export interface PanelShellHandle {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  focus(): void;
}

export function createPanelShell(options: {
  id: string;
  title: string;
  onClose: () => void;
}): PanelShellHandle {
  const body = h('div', { class: 'panel__body' });

  const heading = h('h2', { class: 'panel__title', id: `${options.id}-title` }, options.title);

  const closeButton = h(
    'button',
    {
      class: 'panel__close',
      type: 'button',
      'aria-label': `Close ${options.title}`,
      onClick: () => options.onClose(),
    },
    '✕',
  );

  const element = h(
    'section',
    {
      class: 'panel',
      role: 'dialog',
      'aria-labelledby': `${options.id}-title`,
      'aria-modal': 'false',
      tabindex: '-1',
      onKeydown: (event: Event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === 'Escape') {
          options.onClose();
        }
      },
    },
    h('header', { class: 'panel__header' }, heading, closeButton),
    body,
  );

  return {
    element,
    body,
    focus: () => element.focus(),
  };
}
