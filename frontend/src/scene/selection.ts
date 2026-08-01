import * as Cesium from 'cesium';
import type { BuildingLayer } from './buildingLayer';

/**
 * Design review §11: direct manipulation is the primary interaction —
 * clicking a building entity IS the navigation action into the
 * Inspection Panel (§5B "Click a building -> Inspection Panel opens").
 * Native Cesium picking, no custom hit-testing.
 */
export function attachSelectionHandler(
  viewer: Cesium.Viewer,
  buildingLayer: BuildingLayer,
  onSelect: (buildingId: string | null) => void,
): Cesium.ScreenSpaceEventHandler {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const picked: unknown = viewer.scene.pick(movement.position);
    if (!Cesium.defined(picked) || !(picked as { id?: unknown }).id) {
      onSelect(null);
      return;
    }
    const entity = (picked as { id: Cesium.Entity }).id;
    const buildingId = buildingLayer.buildingIdForEntity(entity);
    onSelect(buildingId);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return handler;
}
