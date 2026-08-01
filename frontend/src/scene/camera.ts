import * as Cesium from 'cesium';
import type { BuildingLayer } from './buildingLayer';

/**
 * Design review §16: no bounding box is hardcoded (EDD Section 4 leaves
 * the study area "Not specified"). The camera frames whatever data is
 * actually loaded — fit-to-data, not a fixed South Mumbai coordinate.
 * When there is no data at all (the honest empty state, §5A), the
 * camera is left at Cesium's own default view rather than flown
 * anywhere invented.
 */
export function flyToBuildings(viewer: Cesium.Viewer, buildingLayer: BuildingLayer): void {
  if (!buildingLayer.hasBuildings()) {
    return;
  }
  void viewer.flyTo([...buildingLayer.allEntities()], {
    duration: 1.5,
  });
}
