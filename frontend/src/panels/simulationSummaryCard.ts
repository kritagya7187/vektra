import { depthColor } from '../domain/colormap';
import { computeDepthHistogram } from '../domain/depthHistogram';
import { computeFloodStats } from '../domain/floodStats';
import { gridMax } from '../domain/floodRaster';
import { floodRunStore } from '../state';
import { clear, h, mount } from '../utils/dom';
const AREA_PRECISION = 2;
const DEPTH_PRECISION = 2;
const MINUTES_PRECISION = 0;
const PERCENT_PRECISION = 1;

function summaryGroup(title: string, rows: readonly (readonly [string, string])[]): HTMLElement {
  return h(
    'div',
    { class: 'summary-card__group' },
    h('h3', { class: 'summary-card__group-title' }, title),
    h(
      'dl',
      { class: 'summary-card__group-body' },
      ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)]),
    ),
  );
}

function depthHistogramChart(grid: readonly (readonly number[])[]): HTMLElement {
  const bins = computeDepthHistogram(grid);
  const maxCount = Math.max(1, ...bins.map((bin) => bin.cellCount));
  const maxDepth = gridMax(grid);
  return h(
    'div',
    { class: 'summary-card__group' },
    h('h3', { class: 'summary-card__group-title' }, 'Depth distribution'),
    h(
      'div',
      { class: 'depth-histogram' },
      ...bins.map((bin) => {
        const representativeM = bin.maxM !== null ? (bin.minM + bin.maxM) / 2 : bin.minM;
        const [r, g, b] = depthColor(representativeM, maxDepth);
        return h(
          'div',
          { class: 'depth-histogram__row' },
          h('span', { class: 'depth-histogram__label' }, `${bin.label} m`),
          h(
            'div',
            { class: 'depth-histogram__track' },
            h('div', {
              class: 'depth-histogram__bar',
              style: `width: ${(bin.cellCount / maxCount) * 100}%; background: rgb(${r}, ${g}, ${b})`,
            }),
          ),
          h('span', { class: 'depth-histogram__count' }, String(bin.cellCount)),
        );
      }),
    ),
  );
}

export function renderSimulationSummaryCard(container: HTMLElement): () => void {
  const render = (): void => {
    const { summary, activeRun } = floodRunStore.get();
    clear(container);
    if (!summary || !activeRun?.aoiBoundsWgs84) {
      return;
    }
    const stats = computeFloodStats(summary, activeRun.aoiBoundsWgs84);
    mount(
      container,
      h(
        'div',
        { class: 'summary-card' },
        h('h2', { class: 'summary-card__title' }, 'Simulation summary'),
        summaryGroup('Spatial', [
          ['Flooded area', `${stats.floodedAreaSqKm.toFixed(AREA_PRECISION)} km²`],
          ['Flooded fraction', `${(stats.floodedFraction * 100).toFixed(PERCENT_PRECISION)}%`],
          ['Max depth', `${stats.maxDepthM.toFixed(DEPTH_PRECISION)} m`],
        ]),
        summaryGroup('Temporal', [
          ['Max arrival', `${stats.maxArrivalMin.toFixed(MINUTES_PRECISION)} min`],
          ['Max duration', `${stats.maxDurationMin.toFixed(MINUTES_PRECISION)} min`],
          ['Simulated time', `${(stats.simulatedDurationS / 60).toFixed(MINUTES_PRECISION)} min`],
          ['Simulated steps', String(stats.stepCount)],
        ]),
        depthHistogramChart(summary.maxDepthM),
        summaryGroup('Mass balance', [
          ['Rainfall input', `${stats.rainfallInputM3.toFixed(0)} m³`],
          ['Infiltration loss', `${stats.infiltrationLossM3.toFixed(0)} m³`],
          ['Boundary outflow', `${stats.boundaryOutflowM3.toFixed(0)} m³`],
        ]),
      ),
    );
  };
  render();
  return floodRunStore.subscribe(render);
}
