import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import type { AoiBoundsWgs84, CityRunBoundary, FloodOutputSummary } from '../api';
import type { LayerId, LayerVisibility } from '../domain/layers';
import type { LonLat } from '../domain/measurement';
import type { TwinBuilding } from '../domain/twinBuildings';
import { depthAtTime } from '../domain/floodPropagation';
import { createAdminBoundaryLayer } from './boundaryLayer';
import { createBuildingLayer } from './buildingLayer';
import { flyToAoi, flyToBuildings, resetCamera } from './camera';
import { createFloodLayers } from './floodLayer';
import { createFloodWaterLayer } from './floodWaterLayer';
import { createMap, setImageryVisible, setTerrainVisible } from './mapViewer';
import { createMeasurementLayers } from './measurementLayer';
import { createPhotorealisticTilesLayer } from './photorealisticTilesLayer';
import { resolveMapClick, type MapClickResult } from './selection';
const BUILDING_EXTRUSION_MIN_ZOOM = 14;
const DEFAULT_VISIBILITY: LayerVisibility = {
  terrain: true,
  imagery: true,
  buildings3d: true,
  maxDepth: true,
  arrivalTime: false,
  duration: false,
  adminBoundary: true,
};
export class TwinScene {
  private readonly map: ReturnType<typeof createMap>;
  private readonly overlay: MapboxOverlay;
  private twinBuildings: readonly TwinBuilding[] = [];
  private selectedBuildingId: string | null = null;
  private floodSummary: FloodOutputSummary | null = null;
  private aoiBoundsWgs84: AoiBoundsWgs84 | null = null;
  private visibility: LayerVisibility = DEFAULT_VISIBILITY;
  private measurementPoints: readonly LonLat[] = [];
  private propagationTMinutes: number | null = null;
  private adminBoundary: CityRunBoundary | null = null;
  private buildingsExtruded = true;
  constructor(container: HTMLElement, onMapClick: (result: MapClickResult) => void) {
    this.map = createMap(container);
    this.buildingsExtruded = this.map.getZoom() >= BUILDING_EXTRUSION_MIN_ZOOM;
    this.overlay = new MapboxOverlay({
      layers: [],
      onClick: (info): void => {
        const result = resolveMapClick(info);
        if (result) {
          onMapClick(result);
        }
      },
      onError: (error: Error): void => {
        console.error(error);
      },
    });
    this.map.addControl(this.overlay);
    this.map.on('error', (event): void => {
      console.error(event.error);
    });
    this.map.on('zoom', (): void => this.handleZoomChange());
  }
  private handleZoomChange(): void {
    const nextExtruded = this.map.getZoom() >= BUILDING_EXTRUSION_MIN_ZOOM;
    if (nextExtruded !== this.buildingsExtruded) {
      this.buildingsExtruded = nextExtruded;
      this.rebuildLayers();
    }
  }
  setTwinBuildings(twinBuildings: readonly TwinBuilding[]): void {
    this.twinBuildings = twinBuildings;
    this.rebuildLayers();
  }
  setSelectedBuilding(buildingId: string | null): void {
    this.selectedBuildingId = buildingId;
    this.rebuildLayers();
  }
  setFloodSummary(summary: FloodOutputSummary | null, aoiBoundsWgs84: AoiBoundsWgs84 | null): void {
    this.floodSummary = summary;
    this.aoiBoundsWgs84 = aoiBoundsWgs84;
    this.rebuildLayers();
  }
  setLayerVisible(layer: LayerId, visible: boolean): void {
    this.visibility = { ...this.visibility, [layer]: visible };
    if (layer === 'terrain') {
      setTerrainVisible(this.map, visible);
    } else if (layer === 'imagery') {
      setImageryVisible(this.map, visible);
    }
    this.rebuildLayers();
  }
  setMeasurementPoints(points: readonly LonLat[]): void {
    this.measurementPoints = points;
    this.rebuildLayers();
  }
  setPropagationTime(tMinutes: number | null): void {
    this.propagationTMinutes = tMinutes;
    this.rebuildLayers();
  }
  setAdminBoundary(boundary: CityRunBoundary | null): void {
    this.adminBoundary = boundary;
    this.rebuildLayers();
  }
  queryTerrainElevationM(lon: number, lat: number): number | null {
    return this.map.queryTerrainElevation([lon, lat]);
  }
  flyToData(): void {
    flyToBuildings(this.map, this.twinBuildings);
  }
  flyToAoi(): void {
    if (this.aoiBoundsWgs84) {
      flyToAoi(this.map, this.aoiBoundsWgs84);
    }
  }
  resetCamera(): void {
    resetCamera(this.map);
  }
  hasBuildings(): boolean {
    return this.twinBuildings.length > 0;
  }
  destroy(): void {
    this.overlay.finalize();
    this.map.remove();
  }
  private rebuildLayers(): void {
    const floodContext =
      this.floodSummary && this.aoiBoundsWgs84
        ? { maxDepthM: this.floodSummary.maxDepthM, aoiBoundsWgs84: this.aoiBoundsWgs84 }
        : null;
    const layers: Layer[] = [
      createBuildingLayer(
        this.twinBuildings,
        this.selectedBuildingId,
        this.visibility.buildings3d,
        floodContext,
        this.buildingsExtruded,
      ),
    ];
    const tilesLayer = createPhotorealisticTilesLayer(this.visibility.buildings3d);
    if (tilesLayer) {
      layers.push(tilesLayer);
    }
    if (this.floodSummary && this.aoiBoundsWgs84) {
      const waterDepthGrid =
        this.propagationTMinutes !== null
          ? depthAtTime(
              this.floodSummary.maxDepthM,
              this.floodSummary.arrivalTimeMin,
              this.propagationTMinutes,
            )
          : this.floodSummary.maxDepthM;
      layers.push(
        createFloodWaterLayer(waterDepthGrid, this.aoiBoundsWgs84, this.visibility.maxDepth),
      );
      layers.push(...createFloodLayers(this.floodSummary, this.aoiBoundsWgs84, this.visibility));
    }
    layers.push(...createMeasurementLayers(this.measurementPoints));
    const boundaryLayer = createAdminBoundaryLayer(this.adminBoundary, this.visibility.adminBoundary);
    if (boundaryLayer) {
      layers.push(boundaryLayer);
    }
    this.overlay.setProps({ layers });
  }
}
