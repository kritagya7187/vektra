import * as Cesium from 'cesium';
import type { TwinBuilding } from '../domain/joinBuildingsWithResults';
import { BuildingLayer } from './buildingLayer';
import { flyToBuildings } from './camera';
import { attachSelectionHandler } from './selection';
import { createViewer } from './viewer';

/**
 * The Twin View (design review §4, §6, §10): a single Cesium Viewer that
 * remains mounted for the lifetime of the app — main.ts constructs this
 * exactly once and never recreates it (§14: "Do not recreate the
 * Viewer"). Every panel reads scene-relevant data through the state
 * layer, never through this class directly (§9 layer separation) —
 * this class's only external surface is the small set of imperative
 * scene operations below, plus the selection callback.
 */
export class TwinScene {
  readonly viewer: Cesium.Viewer;
  private readonly buildingLayer: BuildingLayer;
  private readonly selectionHandler: Cesium.ScreenSpaceEventHandler;

  constructor(container: HTMLElement, onBuildingSelected: (buildingId: string | null) => void) {
    this.viewer = createViewer(container);
    this.buildingLayer = new BuildingLayer(this.viewer);
    this.selectionHandler = attachSelectionHandler(
      this.viewer,
      this.buildingLayer,
      onBuildingSelected,
    );
  }

  setTwinBuildings(twinBuildings: readonly TwinBuilding[]): void {
    this.buildingLayer.setTwinBuildings(twinBuildings);
  }

  setSelectedBuilding(buildingId: string | null): void {
    this.buildingLayer.setSelected(buildingId);
  }

  flyToData(): void {
    flyToBuildings(this.viewer, this.buildingLayer);
  }

  hasBuildings(): boolean {
    return this.buildingLayer.hasBuildings();
  }

  destroy(): void {
    this.selectionHandler.destroy();
    this.buildingLayer.clear();
    this.viewer.destroy();
  }
}
