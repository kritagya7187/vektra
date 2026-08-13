import { ARRIVAL_STOPS, DEPTH_STOPS, DURATION_STOPS } from '../domain/colormap';
import { gridMax } from '../domain/floodRaster';
import { floodRunStore, layerVisibilityStore } from '../state';
import { legendRamp } from '../ui/primitives';
import { clear, h, mount } from '../utils/dom';

export function renderLegend(container: HTMLElement): () => void {
  const render = (): void => {
    const { summary } = floodRunStore.get();
    const visibility = layerVisibilityStore.get();
    clear(container);
    if (!summary) {
      return;
    }
    const ramps: HTMLElement[] = [];
    if (visibility.maxDepth) {
      ramps.push(
        legendRamp({
          title: 'Max depth',
          unit: 'm',
          stops: DEPTH_STOPS,
          maxValue: gridMax(summary.maxDepthM),
        }),
      );
    }
    if (visibility.arrivalTime) {
      ramps.push(
        legendRamp({
          title: 'Arrival time',
          unit: 'min',
          stops: ARRIVAL_STOPS,
          maxValue: gridMax(summary.arrivalTimeMin),
        }),
      );
    }
    if (visibility.duration) {
      ramps.push(
        legendRamp({
          title: 'Duration above threshold',
          unit: 'min',
          stops: DURATION_STOPS,
          maxValue: gridMax(summary.durationAboveThresholdMin),
        }),
      );
    }
    if (ramps.length === 0) {
      return;
    }
    mount(container, h('div', { class: 'legend-stack' }, ...ramps));
  };
  render();
  const unsubA = floodRunStore.subscribe(render);
  const unsubB = layerVisibilityStore.subscribe(render);
  return (): void => {
    unsubA();
    unsubB();
  };
}
