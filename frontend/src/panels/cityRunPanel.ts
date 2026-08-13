import { ApiError, cityRunDownloadUrl, getCityRun, getCityRunBoundary, listCityRuns } from '../api';
import type { CityRunArtifact, CityRunDetail, CityRunSummary } from '../api';
import { setAdminBoundary } from '../state';
import { formatTimestamp, formatUnknown } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

interface Tile {
  readonly tile_id?: string;
  readonly status?: string;
}

function tileGrid(tiles: readonly Tile[]): HTMLElement {
  return h(
    'div',
    { class: 'tile-grid' },
    ...tiles.map((tile) =>
      h('div', {
        class: `tile-grid__cell tile-grid__cell--${tile.status ?? 'pending'}`,
        title: `${tile.tile_id ?? ''}: ${tile.status ?? 'pending'}`,
      }),
    ),
  );
}

function renderDetail(container: HTMLElement, detail: CityRunDetail): void {
  const manifest = detail.manifest;
  const tiles = Array.isArray(manifest.tiles) ? (manifest.tiles as Tile[]) : [];
  const aoi = manifest.aoi_provenance as Record<string, unknown> | undefined;
  const checksums = manifest.input_checksums as Record<string, unknown> | undefined;
  const software = manifest.software_versions as Record<string, unknown> | undefined;
  const summary = detail.runSummary ?? {};

  const runId = typeof manifest.run_id === 'string' ? manifest.run_id : '';
  const artifacts: readonly CityRunArtifact[] = [
    'max-depth-geotiff',
    'arrival-time-geotiff',
    'duration-above-threshold-geotiff',
  ];
  const downloads = h(
    'ul',
    { class: 'export__list' },
    ...artifacts.map((artifact) =>
      h(
        'li',
        {},
        h(
          'a',
          { class: 'export__link', href: cityRunDownloadUrl(runId, artifact), download: true },
          artifact,
        ),
      ),
    ),
  );

  mount(
    container,
    h(
      'dl',
      { class: 'inspection__attributes' },
      h('dt', {}, 'Run id'),
      h('dd', {}, runId),
      h('dt', {}, 'Tiles'),
      h(
        'dd',
        {},
        `${tiles.filter((t) => t.status === 'completed').length} / ${tiles.length} completed`,
      ),
      h('dt', {}, 'Max depth (city)'),
      h('dd', {}, `${formatUnknown(summary.max_depth_m_city)} m`),
      h('dt', {}, 'Wet area'),
      h('dd', {}, `${formatUnknown(summary.wet_area_m2)} m²`),
      h('dt', {}, 'AOI source'),
      h('dd', {}, formatUnknown(aoi?.dataset_name)),
      h('dt', {}, 'AOI area'),
      h('dd', {}, `${formatUnknown(aoi?.area_km2)} km²`),
      h('dt', {}, 'Git commit'),
      h('dd', {}, formatUnknown(software?.git_commit)),
      h('dt', {}, 'DEM checksum'),
      h('dd', {}, formatUnknown(checksums?.dem)),
    ),
    h('p', { class: 'inspection__toggle' }, 'Tile grid'),
    tileGrid(tiles),
    h('p', { class: 'inspection__toggle' }, 'GeoTIFF downloads'),
    downloads,
  );
}

function renderList(
  container: HTMLElement,
  runs: readonly CityRunSummary[],
  onSelect: (runId: string) => void,
): void {
  mount(
    container,
    h(
      'ul',
      { class: 'export__list' },
      ...runs.map((run) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', class: 'export__link', onClick: () => onSelect(run.runId) },
            `${run.runId} · ${run.status} · ${run.tilesCompleted}/${run.tileCount} tiles`,
            run.createdAt ? h('span', {}, ` · ${formatTimestamp(run.createdAt)}`) : null,
          ),
        ),
      ),
      runs.length === 0 ? h('li', {}, 'No city-scale runs found.') : null,
    ),
  );
}

export function renderCityRunPanel(container: HTMLElement, onClose: () => void): PanelController {
  const shell = createPanelShell({ id: 'city-runs', title: 'City-scale runs', onClose });
  mount(container, shell.element);
  shell.focus();
  mount(shell.body, h('p', { role: 'status' }, 'Loading city-scale runs…'));

  void listCityRuns()
    .then((runs) => {
      const listContainer = h('div', {});
      const detailContainer = h('div', {});
      renderList(listContainer, runs, (runId) => {
        mount(detailContainer, h('p', { role: 'status' }, 'Loading run…'));
        void getCityRun(runId)
          .then((detail) => renderDetail(detailContainer, detail))
          .catch((err: unknown) => {
            const message = err instanceof ApiError ? err.message : 'Failed to load run.';
            mount(detailContainer, h('p', { role: 'alert' }, message));
          });
        void getCityRunBoundary(runId)
          .then((boundary) => setAdminBoundary(boundary))
          .catch(() => setAdminBoundary(null));
      });
      mount(shell.body, listContainer, detailContainer);
    })
    .catch((err: unknown) => {
      const message = err instanceof ApiError ? err.message : 'Failed to load city-scale runs.';
      mount(shell.body, h('p', { role: 'alert' }, message));
    });

  return {
    destroy: (): void => {
      setAdminBoundary(null);
      clear(shell.body);
      container.removeChild(shell.element);
    },
  };
}
