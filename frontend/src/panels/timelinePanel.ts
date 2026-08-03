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
import { clear, h, mount } from '../utils/dom';

/**
 * Step 20 §4 (Time Animation, approved scope-down): play/pause/resume/
 * restart/slider/speed over the three real summary layers — persistent
 * chrome, shown only once a completed run's summary is actually loaded
 * (nothing to animate before then).
 */

const METRIC_LABELS: Record<TimelineMetric, string> = {
  maxDepth: 'Max depth',
  arrivalTime: 'Arrival time',
  duration: 'Duration above threshold',
};

const MIN_SPEED_MS = 500;
const MAX_SPEED_MS = 5000;
const SPEED_STEP_MS = 500;

export function renderTimelinePanel(container: HTMLElement): () => void {
  const render = (): void => {
    const { summary } = floodRunStore.get();
    clear(container);

    if (!summary) {
      return;
    }

    const timeline = timelineStore.get();

    const slider = h('input', {
      type: 'range',
      min: '0',
      max: String(TIMELINE_METRICS.length - 1),
      step: '1',
      value: String(timeline.index),
      'aria-label': 'Timeline frame',
      onInput: (event: Event) => seekTimeline(Number((event.target as HTMLInputElement).value)),
    });

    const speedSlider = h('input', {
      type: 'range',
      min: String(MIN_SPEED_MS),
      max: String(MAX_SPEED_MS),
      step: String(SPEED_STEP_MS),
      value: String(timeline.speedMs),
      'aria-label': 'Animation speed (ms per frame)',
      onInput: (event: Event) =>
        setTimelineSpeedMs(Number((event.target as HTMLInputElement).value)),
    });

    mount(
      container,
      h(
        'div',
        { class: 'timeline' },
        h(
          'div',
          { class: 'timeline__controls' },
          h(
            'button',
            {
              type: 'button',
              onClick: () => (timeline.playing ? pauseTimeline() : playTimeline()),
            },
            timeline.playing ? 'Pause' : 'Play',
          ),
          h('button', { type: 'button', onClick: () => restartTimeline() }, 'Restart'),
          h('span', { class: 'timeline__label' }, METRIC_LABELS[TIMELINE_METRICS[timeline.index]]),
        ),
        h('div', { class: 'timeline__slider-row' }, slider),
        h(
          'label',
          { class: 'timeline__speed' },
          `Speed: ${(timeline.speedMs / 1000).toFixed(1)}s/frame`,
          speedSlider,
        ),
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
