import './style.css';
import {
  addMeasurementPoint,
  adminBoundaryStore,
  buildingStore,
  clearFloodInspection,
  clearSelection,
  closePanel,
  floodInspectionStore,
  floodRunStore,
  inspectFloodPoint,
  interactionModeStore,
  LAYER_IDS,
  layerVisibilityStore,
  loadLatestBaselineRun,
  loadTwinBuildings,
  measurementStore,
  openPanel,
  runStore,
  selectBuilding,
  setSceneReady,
  uiStore,
} from './state';
import {
  createPanelHost,
  renderInstrumentRail,
  renderJobStatusPanel,
  renderTimelinePanel,
  renderTopBar,
} from './panels';
import { renderLegend } from './panels/legend';
import { hideSpotReadout, showSpotReadout } from './panels/spotReadout';
import { setElevationQuery } from './scene/terrainQuery';
import { TwinScene } from './scene/twinScene';
import { h, mount } from './utils/dom';
const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('#app root element is missing from index.html.');
}
const mapContainer = h('div', { class: 'map-container', 'aria-hidden': 'true' });
const topBarRoot = h('div', { class: 'topbar-root' });
const railRoot = h('div', { class: 'rail-root' });
const overlayRoot = h('div', { class: 'overlay-root' });
const jobStatusRoot = h('div', { class: 'job-status-root' });
const timelineRoot = h('div', { class: 'timeline-root' });
const stripRoot = h('div', { class: 'strip' }, jobStatusRoot, timelineRoot);
const legendRoot = h('div', {});
const spotReadoutRoot = h('div', {});
const statusRoot = h('div', { class: 'status-root', role: 'status', 'aria-live': 'polite' });
mount(
  appRoot,
  mapContainer,
  h(
    'div',
    { class: 'app-shell' },
    topBarRoot,
    railRoot,
    overlayRoot,
    stripRoot,
    legendRoot,
    spotReadoutRoot,
    statusRoot,
  ),
);
const scene = new TwinScene(mapContainer, (result) => {
  const { mode } = interactionModeStore.get();
  if (mode === 'measure') {
    addMeasurementPoint([result.lon, result.lat]);
    return;
  }
  if (mode !== 'explore' && mode !== 'inspect') {
    return;
  }
  if (result.buildingId) {
    void selectBuilding(result.buildingId);
    openPanel('inspection');
    hideSpotReadout(spotReadoutRoot);
    return;
  }
  clearSelection();
  if (uiStore.get().openPanel === 'inspection') {
    closePanel();
  }
  inspectFloodPoint(result.lon, result.lat);
  openPanel('floodInspection');
  const inspection = floodInspectionStore.get();
  const elevationM = scene.queryTerrainElevationM(result.lon, result.lat);
  const lines = [
    elevationM !== null ? `Elevation: ${elevationM.toFixed(1)} m` : null,
    inspection?.maxDepthM !== null && inspection?.maxDepthM !== undefined
      ? `Depth: ${inspection.maxDepthM.toFixed(2)} m`
      : null,
    inspection?.arrivalTimeMin !== null && inspection?.arrivalTimeMin !== undefined
      ? `Arrival: ${inspection.arrivalTimeMin.toFixed(0)} min`
      : null,
  ].filter((line): line is string => line !== null);
  showSpotReadout(spotReadoutRoot, result.screenX, result.screenY, 'Location', lines);
});
setElevationQuery((lon, lat) => scene.queryTerrainElevationM(lon, lat));
setSceneReady();
renderTopBar(topBarRoot);
renderInstrumentRail(railRoot, {
  onResetCamera: () => scene.resetCamera(),
  onFitAoi: () => scene.flyToAoi(),
  onFitBuildings: () => scene.flyToData(),
});
createPanelHost(overlayRoot);
renderJobStatusPanel(jobStatusRoot);
renderTimelinePanel(timelineRoot, {
  onPropagationTimeChange: (tMinutes) => scene.setPropagationTime(tMinutes),
});
renderLegend(legendRoot);
buildingStore.subscribe((state) => {
  if (state.twinStatus === 'loaded') {
    scene.setTwinBuildings(state.twinBuildings);
  }
});
buildingStore.subscribe((state) => {
  scene.setSelectedBuilding(state.selectedBuildingId);
});
floodRunStore.subscribe((state) => {
  scene.setFloodSummary(state.summary, state.activeRun?.aoiBoundsWgs84 ?? null);
});
layerVisibilityStore.subscribe((visibility) => {
  for (const layer of LAYER_IDS) {
    scene.setLayerVisible(layer, visibility[layer]);
  }
});
measurementStore.subscribe((state) => {
  scene.setMeasurementPoints(state.points);
});
adminBoundaryStore.subscribe((state) => {
  scene.setAdminBoundary(state.boundary);
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
