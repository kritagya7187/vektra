import './style.css';
import {
  buildingStore,
  clearFloodInspection,
  clearSelection,
  closePanel,
  floodRunStore,
  inspectFloodPoint,
  LAYER_IDS,
  layerVisibilityStore,
  loadLatestBaselineRun,
  loadTwinBuildings,
  openPanel,
  runStore,
  selectBuilding,
  setSceneReady,
  uiStore,
} from './state';
import { createPanelHost, renderJobStatusPanel, renderTimelinePanel, renderTopBar } from './panels';
import { TwinScene } from './scene/twinScene';
import { h, mount } from './utils/dom';

/**
 * App bootstrap: constructs the ONE persistent MapLibre+deck.gl scene
 * (scene/twinScene.ts, replacing the retired Cesium Viewer), the minimal
 * top bar, and the overlay panel host, then wires state -> scene
 * reactively. This file is the only place that imports both `scene/*`
 * and `state/*` and `panels/*` together — every other module talks to at
 * most one of those layers, keeping the Scene/API/state separation real
 * rather than nominal.
 */

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('#app root element is missing from index.html.');
}

const mapContainer = h('div', { class: 'map-container', 'aria-hidden': 'true' });
const topBarRoot = h('div', { class: 'topbar-root' });
const overlayRoot = h('div', { class: 'overlay-root' });
const jobStatusRoot = h('div', { class: 'job-status-root' });
const timelineRoot = h('div', { class: 'timeline-root' });
const statusRoot = h('div', { class: 'status-root', role: 'status', 'aria-live': 'polite' });

mount(
  appRoot,
  mapContainer,
  h(
    'div',
    { class: 'app-shell' },
    topBarRoot,
    overlayRoot,
    jobStatusRoot,
    timelineRoot,
    statusRoot,
  ),
);

const scene = new TwinScene(mapContainer, (result) => {
  if (result.buildingId) {
    void selectBuilding(result.buildingId);
    openPanel('inspection');
    return;
  }

  clearSelection();
  if (uiStore.get().openPanel === 'inspection') {
    closePanel();
  }

  inspectFloodPoint(result.lon, result.lat);
  openPanel('floodInspection');
});
setSceneReady();

renderTopBar(topBarRoot, (panel) => openPanel(panel));
createPanelHost(overlayRoot);
renderJobStatusPanel(jobStatusRoot);
renderTimelinePanel(timelineRoot);

// Scene reacts to Building state — never the inverse.
buildingStore.subscribe((state) => {
  if (state.twinStatus === 'loaded') {
    scene.setTwinBuildings(state.twinBuildings);
  }
});
buildingStore.subscribe((state) => {
  scene.setSelectedBuilding(state.selectedBuildingId);
});

// Scene reacts to flood-run state — never the inverse.
floodRunStore.subscribe((state) => {
  scene.setFloodSummary(state.summary, state.activeRun?.aoiBoundsWgs84 ?? null);
});

// Scene reacts to layer-visibility state — never the inverse. Re-applies
// every layer on any change rather than diffing: this store is small and
// every setLayerVisible() call is idempotent, so simplicity wins over a
// hand-rolled diff for six booleans.
layerVisibilityStore.subscribe((visibility) => {
  for (const layer of LAYER_IDS) {
    scene.setLayerVisible(layer, visibility[layer]);
  }
});

function renderStatus(): void {
  const run = runStore.get();
  const twin = buildingStore.get();

  if (run.status === 'error') {
    mount(
      statusRoot,
      h('p', { role: 'alert' }, run.error?.message ?? 'Failed to load the active simulation run.'),
    );
    return;
  }
  if (twin.twinStatus === 'error') {
    mount(
      statusRoot,
      h('p', { role: 'alert' }, twin.twinError?.message ?? 'Failed to load building data.'),
    );
    return;
  }
  if (run.status === 'loaded' && run.activeRun === null) {
    mount(statusRoot, h('p', {}, 'No completed baseline simulation run exists yet.'));
    return;
  }
  if (twin.twinStatus === 'loaded' && twin.twinBuildings.length === 0) {
    mount(statusRoot, h('p', {}, 'No building data is available yet.'));
    return;
  }
  mount(statusRoot);
}
runStore.subscribe(renderStatus);
buildingStore.subscribe(renderStatus);

let hasFlownToData = false;
buildingStore.subscribe((state) => {
  if (state.twinStatus === 'loaded' && state.twinBuildings.length > 0 && !hasFlownToData) {
    hasFlownToData = true;
    scene.flyToData();
  }
});

let hasFlownToFloodRun = false;
floodRunStore.subscribe((state) => {
  if (state.summary && !hasFlownToFloodRun) {
    hasFlownToFloodRun = true;
    scene.flyToAoi();
  }
  if (!state.activeRun) {
    hasFlownToFloodRun = false;
    clearFloodInspection();
  }
});

async function bootstrap(): Promise<void> {
  renderStatus();
  void loadLatestBaselineRun().catch(() => null);
  await loadTwinBuildings().catch(() => undefined);
}

void bootstrap();
