import type { HeatExposureFactorValue } from '../api';
import { formatFactorKey, formatNullableNumber } from '../utils/formatting';
import { h } from '../utils/dom';

/**
 * Heat Exposure Factor Breakdown (design review §4 item 3, EDD Section
 * 22's "Heat Exposure Index breakdown"). Renders all 5 factors,
 * INCLUDING the ones marked not computable, with their real `notes`
 * text — never hidden, never approximated (design review §19, EDD
 * Section 18's own instruction).
 */
export function renderFactorBreakdown(factors: readonly HeatExposureFactorValue[]): HTMLElement {
  if (factors.length === 0) {
    return h('p', { class: 'factors__empty' }, 'No factor breakdown is available for this result.');
  }

  return h(
    'ul',
    { class: 'factors', 'aria-label': 'Heat Exposure Index factor breakdown' },
    ...factors.map((factor) =>
      h(
        'li',
        {
          class: `factors__item factors__item--${factor.isComputable ? 'computable' : 'not-computable'}`,
        },
        h(
          'div',
          { class: 'factors__item-header' },
          h('span', { class: 'factors__name' }, formatFactorKey(factor.factorKey)),
          h(
            'span',
            { class: 'factors__badge' },
            factor.isComputable ? formatNullableNumber(factor.factorValue) : 'Not computable',
          ),
        ),
        factor.notes ? h('p', { class: 'factors__notes' }, factor.notes) : null,
      ),
    ),
  );
}
