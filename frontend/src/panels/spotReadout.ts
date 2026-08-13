import { clear, h, mount } from '../utils/dom';

const AUTO_HIDE_MS = 4000;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function showSpotReadout(
  container: HTMLElement,
  x: number,
  y: number,
  title: string,
  lines: readonly string[],
): void {
  clear(container);
  clearTimeout(hideTimer);
  mount(
    container,
    h(
      'div',
      { class: 'spot-readout', style: `left: ${x + 12}px; top: ${y + 12}px` },
      h('div', { class: 'spot-readout__title' }, title),
      ...lines.map((line) => h('div', {}, line)),
    ),
  );
  hideTimer = setTimeout(() => clear(container), AUTO_HIDE_MS);
}

export function hideSpotReadout(container: HTMLElement): void {
  clearTimeout(hideTimer);
  clear(container);
}
