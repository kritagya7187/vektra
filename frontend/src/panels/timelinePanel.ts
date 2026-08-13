import type { FloodOutputSummary } from '../api';
import {
  floodRunStore,
  pauseTimeline,
  playTimeline,
  restartTimeline,
  seekTimeline,
  setTimelineSpeedMs,
  timelineStore,
} from '../state';
import { TIMELINE_METRICS, type TimelineMetric } from '../domain/timeline';
import { maxArrivalMinutes } from '../domain/floodPropagation';
import { button, chip } from '../ui/primitives';
import { clear, h, mount } from '../utils/dom';
const METRIC_LABELS: Record<TimelineMetric, string> = {
  maxDepth: 'Max depth',
  arrivalTime: 'Arrival time',
  duration: 'Duration',
};
const MIN_SPEED_MS = 500;
const MAX_SPEED_MS = 5000;
const SPEED_STEP_MS = 500;
const PROPAGATION_TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
export interface TimelinePanelActions {
  readonly onPropagationTimeChange: (tMinutes: number | null) => void;
}
export function renderTimelinePanel(
  container: HTMLElement,
  actions: TimelinePanelActions,
): () => void {
  let propagationTMinutes: number | null = null;
  let lastSummary: FloodOutputSummary | null = null;
  const render = (): void => {
    const { summary } = floodRunStore.get();
    clear(container);
    if (!summary) {
      lastSummary = null;
      return;
    }
    if (summary !== lastSummary) {
      lastSummary = summary;
      propagationTMinutes = null;
      actions.onPropagationTimeChange(null);
    }
    const timeline = timelineStore.get();
    const speedSlider = h('input', {
      type: 'range',
      min: String(MIN_SPEED_MS),
      max: String(MAX_SPEED_MS),
      step: String(SPEED_STEP_MS),
      value: String(timeline.speedMs),
      'aria-label': 'Frame interval (ms)',
      onInput: (event: Event) =>
        setTimelineSpeedMs(Number((event.target as HTMLInputElement).value)),
    });
    const maxArrival = maxArrivalMinutes(summary.arrivalTimeMin);
    const currentT = propagationTMinutes ?? Math.ceil(maxArrival);
    const fillPct = maxArrival > 0 ? (currentT / maxArrival) * 100 : 0;
    const propagationRow =
      maxArrival > 0
        ? h(
            'div',
            { class: 'timeline__row timeline__row--propagation' },
            h(
              'div',
              { class: 'propagation' },
              h(
                'div',
                { class: 'propagation__header' },
                h('span', { class: 'propagation__title' }, 'Flood propagation'),
                h('span', { class: 'propagation__subtitle' }, 'arrival-time reconstruction'),
                h(
                  'span',
                  { class: 'propagation__value' },
                  propagationTMinutes === null ? 'Final state' : `T+${Math.round(propagationTMinutes)} min`,
                ),
              ),
              h(
                'div',
                { class: 'propagation__track-wrap' },
                h(
                  'div',
                  { class: 'propagation__ticks' },
                  ...PROPAGATION_TICK_FRACTIONS.map((fraction) =>
                    h('span', { class: 'propagation__tick', style: `left: ${fraction * 100}%` }),
                  ),
                ),
                h('input', {
                  type: 'range',
                  class: 'propagation__range',
                  min: '0',
                  max: String(Math.ceil(maxArrival)),
                  step: '1',
                  value: String(currentT),
                  style: `background: linear-gradient(to right, var(--color-active) 0%, var(--color-active) ${fillPct}%, rgba(255, 255, 255, 0.12) ${fillPct}%, rgba(255, 255, 255, 0.12) 100%)`,
                  'aria-label': 'Flood propagation time (arrival-time reconstruction)',
                  onInput: (event: Event) => {
                    propagationTMinutes = Number((event.target as HTMLInputElement).value);
                    actions.onPropagationTimeChange(propagationTMinutes);
                    render();
                  },
                }),
              ),
            ),
            button({
              label: 'Final',
              variant: 'ghost',
              disabled: propagationTMinutes === null,
              onClick: () => {
                propagationTMinutes = null;
                actions.onPropagationTimeChange(null);
                render();
              },
            }),
          )
        : null;
    mount(
      container,
      h(
        'div',
        { class: 'timeline' },
        h(
          'div',
          { class: 'timeline__row' },
          h(
            'div',
            { class: 'timeline__controls' },
            button({
              iconName: 'simulate',
              title: timeline.playing ? 'Pause' : 'Play',
              ariaLabel: timeline.playing ? 'Pause' : 'Play',
              active: timeline.playing,
              onClick: () => (timeline.playing ? pauseTimeline() : playTimeline()),
            }),
            button({
              iconName: 'resetCamera',
              title: 'Restart',
              ariaLabel: 'Restart',
              onClick: () => restartTimeline(),
            }),
          ),
          h(
            'div',
            { class: 'timeline__frames' },
            ...TIMELINE_METRICS.map((metric, index) =>
              chip({
                label: METRIC_LABELS[metric],
                active: timeline.index === index,
                onClick: () => seekTimeline(index),
              }),
            ),
          ),
          h(
            'label',
            { class: 'timeline__speed' },
            `${(timeline.speedMs / 1000).toFixed(1)}s`,
            speedSlider,
          ),
        ),
        propagationRow,
      ),
    );
  };
  render();
  const unsubTimeline = timelineStore.subscribe(render);
  const unsubRun = floodRunStore.subscribe(render);
  return () => {
    unsubTimeline();
    unsubRun();
  };
}
