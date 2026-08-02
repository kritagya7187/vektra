import * as Cesium from 'cesium';
import type { BuildingLayer } from './buildingLayer';

/**
 * Design review §16: no bounding box is hardcoded (EDD Section 4 leaves
 * the study area "Not specified"). The camera frames whatever data is
 * actually loaded — fit-to-data, not a fixed South Mumbai coordinate.
 * When there is no data at all (the honest empty state, §5A), the
 * camera is left at Cesium's own default view rather than flown
 * anywhere invented.
 *
 * Thermal-field visual redirect: `offset` is a real Viewer.flyTo option
 * (HeadingPitchRange, confirmed against the installed Cesium types) —
 * it frames the SAME fit-to-data bounding sphere from a fixed oblique
 * angle instead of Cesium's own default (near-top-down) fit, matching
 * the reference visualization's isometric/oblique-aerial camera. Still
 * not a hardcoded coordinate — only the ANGLE is fixed, the target
 * remains whatever real data is loaded. `range` is left undefined so
 * Cesium still auto-fits the distance to the real data's extent.
 */
const OBLIQUE_HEADING = Cesium.Math.toRadians(-30);
const OBLIQUE_PITCH = Cesium.Math.toRadians(-45);

export function flyToBuildings(viewer: Cesium.Viewer, buildingLayer: BuildingLayer): void {
  if (!buildingLayer.hasBuildings()) {
    return;
  }
  void viewer.flyTo([...buildingLayer.allEntities()], {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(OBLIQUE_HEADING, OBLIQUE_PITCH),
  });
}
