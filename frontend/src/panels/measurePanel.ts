import { sampleGridAt } from '../domain/floodRaster';
import { pathDistanceMeters, polygonAreaSqMeters, type LonLat } from '../domain/measurement';
import { sampleProfile, type ProfileSample } from '../domain/crossSection';
import { queryElevation } from '../scene/terrainQuery';
import { clearMeasurement, floodRunStore, measurementStore, undoMeasurementPoint } from '../state';
import { button } from '../ui/primitives';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

const PROFILE_SAMPLE_COUNT = 40;
const PROFILE_WIDTH = 320;
const PROFILE_HEIGHT = 80;

function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`;
}

function formatSqMeters(sqm: number): string {
  return sqm >= 1000000 ? `${(sqm / 1000000).toFixed(3)} km²` : `${sqm.toFixed(0)} m²`;
}

function profileSvg(samples: readonly ProfileSample[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`);
  svg.setAttribute('width', String(PROFILE_WIDTH));
  svg.setAttribute('height', String(PROFILE_HEIGHT));
  svg.setAttribute('class', 'profile-svg');

  const elevations = samples.map((sample) => sample.elevationM).filter((v): v is number => v !== null);
  if (elevations.length === 0) {
    return svg;
  }
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const range = max - min || 1;

  const toPoint = (index: number, value: number): string => {
    const x = (index / (samples.length - 1)) * PROFILE_WIDTH;
    const y = PROFILE_HEIGHT - ((value - min) / range) * PROFILE_HEIGHT;
    return `${x},${y}`;
  };

  const elevationPoints = samples
    .map((sample, i) => (sample.elevationM !== null ? toPoint(i, sample.elevationM) : null))
    .filter((p): p is string => p !== null)
    .join(' ');
  const elevationLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  elevationLine.setAttribute('points', elevationPoints);
  elevationLine.setAttribute('fill', 'none');
  elevationLine.setAttribute('stroke', 'var(--color-text-muted)');
  elevationLine.setAttribute('stroke-width', '1.5');
  svg.appendChild(elevationLine);

  const hasDepth = samples.some((sample) => sample.depthM !== null && sample.depthM > 0);
  if (hasDepth) {
    const depthPoints = samples
      .map((sample, i) =>
        sample.elevationM !== null ? toPoint(i, sample.elevationM + (sample.depthM ?? 0)) : null,
      )
      .filter((p): p is string => p !== null)
      .join(' ');
    const depthLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    depthLine.setAttribute('points', depthPoints);
    depthLine.setAttribute('fill', 'none');
    depthLine.setAttribute('stroke', 'var(--color-active)');
    depthLine.setAttribute('stroke-width', '1.5');
    svg.appendChild(depthLine);
  }

  return svg;
}

function renderProfile(container: HTMLElement, points: readonly LonLat[]): void {
  const { summary, activeRun } = floodRunStore.get();
  const aoiBounds = activeRun?.aoiBoundsWgs84 ?? null;
  const samples = sampleProfile(
    points,
    PROFILE_SAMPLE_COUNT,
    (lon, lat) => queryElevation(lon, lat),
    summary && aoiBounds
      ? (lon, lat): number | null => sampleGridAt(summary.maxDepthM, aoiBounds, lon, lat)
      : null,
  );
  clear(container);
  if (samples.length === 0) {
    return;
  }
  const svgWrap = h('div', { class: 'profile-svg-wrap' });
  svgWrap.appendChild(profileSvg(samples));
  mount(
    container,
    h('p', { class: 'measure__hint' }, 'Elevation profile (terrain, and flood depth if available):'),
    svgWrap,
  );
}

export function renderMeasurePanel(container: HTMLElement, onClose: () => void): PanelController {
  const shell = createPanelShell({ id: 'measure', title: 'Measure', onClose });
  mount(container, shell.element);
  shell.focus();

  const profileContainer = h('div', {});

  const render = (): void => {
    const { points } = measurementStore.get();
    clear(shell.body);
    mount(
      shell.body,
      h(
        'p',
        { class: 'measure__hint' },
        'Click the map to place vertices. Distance is the path length; area appears once you have at least 3 points.',
      ),
      h(
        'div',
        { class: 'measure__readout' },
        h('span', {}, `Points: ${points.length}`),
        h('span', {}, `Distance: ${formatMeters(pathDistanceMeters(points))}`),
        points.length >= 3
          ? h('span', {}, `Area: ${formatSqMeters(polygonAreaSqMeters(points))}`)
          : null,
      ),
      h(
        'div',
        { class: 'simulate__actions' },
        button({ label: 'Undo point', variant: 'ghost', onClick: undoMeasurementPoint }),
        button({ label: 'Clear', variant: 'ghost', onClick: clearMeasurement }),
      ),
      profileContainer,
    );
    if (points.length >= 2) {
      renderProfile(profileContainer, points);
    } else {
      clear(profileContainer);
    }
  };

  render();
  const unsubscribe = measurementStore.subscribe(render);
  return {
    destroy: (): void => {
      unsubscribe();
      container.removeChild(shell.element);
    },
  };
}
