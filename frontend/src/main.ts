import './style.css';
import {
  buildingStore,
  closePanel,
  clearSelection,
  loadLatestBaselineRun,
  loadTwinBuildings,
  openPanel,
  runStore,
  selectBuilding,
  setSceneReady,
  uiStore,
} from './state';
import { createPanelHost, renderTopBar } from './panels';
import { TwinScene } from './scene/twinScene';
import { h, mount } from './utils/dom';

/**
 * App bootstrap: constructs the ONE persistent Cesium Viewer, the
 * minimal top bar, and the overlay panel host, then wires state -> scene
 * reactively. This file is the only place that imports both `scene/*`
 * and `state/*` and `panels/*` together — every other module talks to
 * at most one of those layers, keeping the Scene/API/state separation
 * real rather than nominal.
 */

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('#app root element is missing from index.html.');
}

const cesiumContainer = h('div', { class: 'cesium-container', 'aria-hidden': 'true' });
const topBarRoot = h('div', { class: 'topbar-root' });
const overlayRoot = h('div', { class: 'overlay-root' });
const statusRoot = h('div', { class: 'status-root', role: 'status', 'aria-live': 'polite' });

mount(
  appRoot,
  cesiumContainer,
  h('div', { class: 'app-shell' }, topBarRoot, overlayRoot, statusRoot),
);

const scene = new TwinScene(cesiumContainer, (buildingId) => {
  if (buildingId) {
    void selectBuilding(buildingId);
    openPanel('inspection');
  } else {
    clearSelection();
    if (uiStore.get().openPanel === 'inspection') {
      closePanel();
    }
  }
});
setSceneReady();

renderTopBar(topBarRoot, (panel) => openPanel(panel));
createPanelHost(overlayRoot);

// Scene reacts to Building state — never the inverse.
buildingStore.subscribe((state) => {
  if (state.twinStatus === 'loaded') {
    scene.setTwinBuildings(state.twinBuildings);
  }
});
buildingStore.subscribe((state) => {
  scene.setSelectedBuilding(state.selectedBuildingId);
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

async function bootstrap(): Promise<void> {
  renderStatus();
  void loadLatestBaselineRun().catch(() => null);
  await loadTwinBuildings().catch(() => undefined);
}

void bootstrap();
