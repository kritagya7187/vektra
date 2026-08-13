import { h } from '../utils/dom';
import { formatRunStatus } from '../utils/formatting';
import { icon, type IconName } from './icons';

function iconEl(name: IconName, size?: number): HTMLElement {
  const span = h('span', { class: 'icon-wrap' });
  span.appendChild(icon(name, size));
  return span;
}

export function button(options: {
  readonly label?: string;
  readonly iconName?: IconName;
  readonly variant?: 'primary' | 'ghost' | 'danger';
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly ariaLabel?: string;
  readonly onClick: () => void;
}): HTMLElement {
  const classes = ['btn', `btn--${options.variant ?? 'ghost'}`];
  if (options.active) classes.push('btn--active');
  const el = h(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      disabled: options.disabled ?? false,
      title: options.title,
      'aria-label': options.ariaLabel ?? options.label,
      'aria-pressed': options.active !== undefined ? String(options.active) : undefined,
      onClick: () => options.onClick(),
    },
    options.iconName ? iconEl(options.iconName) : null,
    options.label ?? null,
  );
  return el;
}

export function chip(options: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}): HTMLElement {
  return h(
    'button',
    {
      type: 'button',
      class: `chip${options.active ? ' chip--active' : ''}`,
      'aria-pressed': String(options.active),
      onClick: () => options.onClick(),
    },
    options.label,
  );
}

export interface DisclosureHandle {
  readonly element: HTMLElement;
}

export function disclosure(options: {
  readonly label: string;
  readonly startOpen?: boolean;
  readonly body: HTMLElement;
}): DisclosureHandle {
  let open = options.startOpen ?? false;
  const chevronWrap = h('span', { class: 'disclosure__chevron' }, iconEl('chevron', 14));
  options.body.classList.add('disclosure__body');
  options.body.hidden = !open;
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'disclosure__toggle',
      'aria-expanded': String(open),
      onClick: () => {
        open = !open;
        options.body.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        element.classList.toggle('disclosure--open', open);
      },
    },
    h('span', {}, options.label),
    chevronWrap,
  );
  const element = h(
    'div',
    { class: `disclosure${open ? ' disclosure--open' : ''}` },
    toggle,
    options.body,
  );
  return { element };
}

const STATUS_TONE: Record<string, 'neutral' | 'active' | 'ok' | 'danger'> = {
  pending: 'neutral',
  running: 'active',
  completed: 'ok',
  failed: 'danger',
  cancelled: 'neutral',
  unknown: 'neutral',
};

export function statusPill(status: string): HTMLElement {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return h(
    'span',
    { class: `status-pill status-pill--${tone}` },
    h('span', { class: 'status-pill__dot' }),
    formatRunStatus(status),
  );
}

export function legendRamp(options: {
  readonly title: string;
  readonly unit: string;
  readonly stops: readonly (readonly [number, number, number])[];
  readonly maxValue: number;
}): HTMLElement {
  const gradient = options.stops
    .map(([r, g, b], index) => {
      const pct = (index / (options.stops.length - 1)) * 100;
      return `rgb(${r},${g},${b}) ${pct}%`;
    })
    .join(', ');
  return h(
    'div',
    { class: 'legend' },
    h('span', { class: 'legend__title' }, options.title),
    h('div', { class: 'legend__ramp', style: `background: linear-gradient(90deg, ${gradient})` }),
    h(
      'div',
      { class: 'legend__ticks' },
      h('span', {}, '0'),
      h('span', {}, `${Math.round(options.maxValue * 100) / 100} ${options.unit}`),
    ),
  );
}
