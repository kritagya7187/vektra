import './style.css';
import {
  buildingStore,
  closePanel,
  clearSelection,
  deriveTwinBuildingsForResults,
  loadLatestBaselineRun,
  loadTwinForRun,
  openPanel,
  runStore,
  scenarioStore,
  sceneStore,
  selectBuilding,
  setSceneReady,
  uiStore,
} from './state';
import { createPanelHost, renderLayerControl, renderLegendBar, renderTopBar } from './panels';
import { computeVisualizationRanges } from './domain/colorRamps';
import { TwinScene } from './scene/twinScene';
import { h, mount } from './utils/dom';

/**
 * App bootstrap (design review §2, §10): constructs the ONE persistent
 * Cesium Viewer, the minimal top bar, and the overlay panel host, then
 * wires state -> scene reactively. This file is the only place that
 * imports both `scene/*` and `state/*` and `panels/*` together — every
 * other module talks to at most one of those layers, keeping the
 * Scene/API/state separation real rather than nominal.
 */

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('#app root element is missing from index.html.');
}

const cesiumContainer = h('div', { class: 'cesium-container', 'aria-hidden': 'true' });
const topBarRoot = h('div', { class: 'topbar-root' });
const overlayRoot = h('div', { class: 'overlay-root' });
const layerControlRoot = h('div', { class: 'layer-control-root' });
const legendBarRoot = h('div', { class: 'legend-bar-root' });
const statusRoot = h('div', { class: 'status-root', role: 'status', 'aria-live': 'polite' });

mount(
  appRoot,
  cesiumContainer,
  h(
    'div',
    { class: 'app-shell' },
    topBarRoot,
    overlayRoot,
    layerControlRoot,
    legendBarRoot,
    statusRoot,
  ),
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
renderLayerControl(layerControlRoot);
renderLegendBar(legendBarRoot);

// Visualization mode (Default/Thermal/NDVI/Land Cover) is orthogonal to
// stylingMode's baseline/scenario toggle below — either result set can
// be viewed under any layer. Ranges are computed here (not inside
// BuildingLayer, which stays free of any state/ import) from whichever
// twinBuildings are currently loaded, then passed down.
function applyVisualizationMode(): void {
  const { activeVisualizationMode } = sceneStore.get();
  const { twinBuildings } = buildingStore.get();
  const ranges = computeVisualizationRanges(twinBuildings);
  scene.setVisualizationMode(activeVisualizationMode, ranges, twinBuildings);
}
sceneStore.subscribe(applyVisualizationMode);
buildingStore.subscribe((state) => {
  if (state.twinStatus === 'loaded') {
    applyVisualizationMode();
  }
});

// Scene reacts to Building state — never the inverse (layer separation, §9).
buildingStore.subscribe((state) => {
  if (state.twinStatus !== 'loaded') {
    return;
  }
  if (sceneStore.get().stylingMode === 'baseline') {
    scene.setTwinBuildings(state.twinBuildings);
  }
});
buildingStore.subscribe((state) => {
  scene.setSelectedBuilding(state.selectedBuildingId);
});

// Comparison Mode's baseline/scenario toggle (§5D) re-styles the SAME
// scene from whichever result set is active — no page navigation, no
// new fetch (deriveTwinBuildingsForResults reuses cached geometry).
function applyStylingMode(): void {
  const { stylingMode } = sceneStore.get();
  if (stylingMode === 'baseline') {
    scene.setTwinBuildings(buildingStore.get().twinBuildings);
    return;
  }
  const { comparison } = scenarioStore.get();
  if (comparison?.scenarioResults) {
    scene.setTwinBuildings(deriveTwinBuildingsForResults(comparison.scenarioResults));
  }
}
sceneStore.subscribe(applyStylingMode);
scenarioStore.subscribe(applyStylingMode);

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
    mount(
      statusRoot,
      h(
        'p',
        {},
        'No completed baseline simulation run exists yet. Run the Heat Exposure Engine to populate the twin.',
      ),
    );
    return;
  }
  if (twin.twinStatus === 'loaded' && twin.twinBuildings.length === 0) {
    mount(statusRoot, h('p', {}, 'The active run has no building results.'));
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
  const run = await loadLatestBaselineRun().catch(() => null);
  if (run) {
    await loadTwinForRun(run).catch(() => undefined);
  }
}

void bootstrap();
