import * as Cesium from 'cesium';
import type { VisualizationMode, VisualizationRanges } from '../domain/colorRamps';
import type { TwinBuilding } from '../domain/joinBuildingsWithResults';
import { BuildingLayer } from './buildingLayer';
import { flyToBuildings } from './camera';
import { attachSelectionHandler } from './selection';
import { ThermalFieldLayer } from './thermalFieldLayer';
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
const EMPTY_RANGES: VisualizationRanges = { thermal: null, ndvi: null };

export class TwinScene {
  readonly viewer: Cesium.Viewer;
  private readonly buildingLayer: BuildingLayer;
  private readonly thermalFieldLayer: ThermalFieldLayer;
  private readonly selectionHandler: Cesium.ScreenSpaceEventHandler;
  private currentMode: VisualizationMode = 'default';
  private currentRanges: VisualizationRanges = EMPTY_RANGES;

  constructor(container: HTMLElement, onBuildingSelected: (buildingId: string | null) => void) {
    this.viewer = createViewer(container);
    this.buildingLayer = new BuildingLayer(this.viewer);
    this.thermalFieldLayer = new ThermalFieldLayer(this.viewer);
    this.selectionHandler = attachSelectionHandler(
      this.viewer,
      this.buildingLayer,
      onBuildingSelected,
    );
  }

  setTwinBuildings(twinBuildings: readonly TwinBuilding[]): void {
    this.buildingLayer.setTwinBuildings(twinBuildings);
    this.refreshThermalField(twinBuildings);
  }

  setSelectedBuilding(buildingId: string | null): void {
    this.buildingLayer.setSelected(buildingId);
  }

  setVisualizationMode(
    mode: VisualizationMode,
    ranges: VisualizationRanges,
    twinBuildings: readonly TwinBuilding[],
  ): void {
    this.currentMode = mode;
    this.currentRanges = ranges;
    this.buildingLayer.setVisualizationMode(mode, ranges);
    this.refreshThermalField(twinBuildings);
  }

  /**
   * Thermal-field visual redirect (Phase 2b spike): the halo is
   * thermal-mode-specific (per the approved design, only
   * "heat concentration" gets a field treatment) — cleared in every
   * other mode rather than left showing stale data.
   */
  private refreshThermalField(twinBuildings: readonly TwinBuilding[]): void {
    if (this.currentMode === 'thermal') {
      this.thermalFieldLayer.setTwinBuildings(twinBuildings, this.currentRanges);
    } else {
      this.thermalFieldLayer.clear();
    }
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
    this.thermalFieldLayer.clear();
    this.viewer.destroy();
  }
}
