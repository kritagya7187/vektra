import { h, mount } from '../utils/dom';
import { formatFactorKey } from '../utils/formatting';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

const FACTOR_KEYS_IN_ORDER = [
  'thermal_signature',
  'vegetation_land_cover',
  'morphology_density',
  'exposure_shading',
  'meteorological_context',
] as const;

/**
 * Design review §19, the Critical UX Requirement, made literal: the
 * default and current state of every HeatExposureResult.indexValue is
 * NULL (EDD Section 18's combination methodology is explicitly "Requires
 * future implementation"). This legend's job today is honestly
 * communicating data availability, not driving a color gradient that
 * does not exist — no color ramp is rendered, because none is real.
 */
export function renderLegend(container: HTMLElement, onClose: () => void): PanelController {
  const shell = createPanelShell({ id: 'legend', title: 'Legend', onClose });

  const body = h(
    'div',
    { class: 'legend' },
    h(
      'p',
      { class: 'legend__status', role: 'status' },
      'Composite Heat Exposure Index: not yet computable.',
    ),
    h(
      'p',
      { class: 'legend__note' },
      'The combination methodology for these five factors into a single index value is not yet defined (EDD Section 18). Buildings are rendered in a neutral, uncolored material until it is.',
    ),
    h(
      'ul',
      { class: 'legend__factors', 'aria-label': 'Heat Exposure Index factors' },
      ...FACTOR_KEYS_IN_ORDER.map((key) =>
        h(
          'li',
          { class: 'legend__factor' },
          h('span', { class: 'legend__factor-name' }, formatFactorKey(key)),
          h(
            'span',
            {
              class: `legend__factor-state legend__factor-state--${key === 'meteorological_context' ? 'computable' : 'not-computable'}`,
            },
            key === 'meteorological_context' ? 'Computable' : 'Not computable',
          ),
        ),
      ),
    ),
  );

  mount(shell.body, body);
  mount(container, shell.element);
  shell.focus();

  return {
    destroy: (): void => {
      container.removeChild(shell.element);
    },
  };
}
