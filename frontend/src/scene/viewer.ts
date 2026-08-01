import * as Cesium from 'cesium';
import { config } from '../config';

/**
 * Design review §6: a single Cesium Viewer instance, default widgets
 * disabled (base-layer picker, home button, geocoder, timeline/animation,
 * scene-mode picker, etc.) — the "copied Cesium example app" chrome the
 * approved design explicitly rules out. Camera navigation stays native;
 * everything else is the custom overlay layer (src/panels).
 *
 * Cesium World Terrain via Cesium ion (Section 20, 12) using the modern
 * Terrain.fromWorldTerrain() API. No environmental/raster imagery layer
 * is added — none is servable by the backend (design review §6, §18)
 * and none is named in Section 20/22; the Viewer's own default ion
 * imagery layer provides base context only.
 */
export function createViewer(container: HTMLElement): Cesium.Viewer {
  Cesium.Ion.defaultAccessToken = config.cesiumIonToken;

  const viewer = new Cesium.Viewer(container, {
    terrain: Cesium.Terrain.fromWorldTerrain(),
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    vrButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    scene3DOnly: true,
    shouldAnimate: true,
  });

  // The default Cesium credit/logo container remains (ion's own terms of
  // use require attribution) but every other stock widget above is gone
  // — this is the entire "minimal chrome" surface Cesium ships with.
  viewer.scene.globe.depthTestAgainstTerrain = true;

  return viewer;
}
