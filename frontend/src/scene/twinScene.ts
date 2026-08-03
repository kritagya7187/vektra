import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import type { AoiBoundsWgs84, FloodOutputSummary } from '../api';
import type { LayerId, LayerVisibility } from '../domain/layers';
import type { TwinBuilding } from '../domain/twinBuildings';
import { createBuildingPickLayer } from './buildingPickLayer';
import { flyToAoi, flyToBuildings, resetCamera } from './camera';
import { createFloodLayers } from './floodLayer';
import { createMap, setImageryVisible, setTerrainVisible } from './mapViewer';
import { createPhotorealisticTilesLayer } from './photorealisticTilesLayer';
import { resolveMapClick, type MapClickResult } from './selection';

const DEFAULT_VISIBILITY: LayerVisibility = {
  terrain: true,
  imagery: true,
  buildings3d: true,
  maxDepth: true,
  arrivalTime: false,
  duration: false,
};

/**
 * The Twin View: a single MapLibre Map + one deck.gl MapboxOverlay,
 * replacing the single Cesium Viewer scene/viewer.ts (retired) used to
 * own — main.ts still constructs this exactly once and never recreates
 * it. Every panel reads scene-relevant data through the state layer,
 * never through this class directly, same rule as before.
 *
 * Public interface: setTwinBuildings/flyToData/hasBuildings/destroy keep
 * their exact original signatures, so main.ts's existing one-way
 * state->scene wiring needed no rework for those. setSelectedBuilding is
 * kept as a no-op (documented below) purely to preserve that same
 * interface — it has nothing to visually do now (see its own docstring).
 * The constructor's callback is a disclosed, necessary change: it must
 * now report a click's real coordinates for flood-cell inspection (§7),
 * not only a buildingId — main.ts (not this class) decides which of the
 * two the click actually means.
 */
export class TwinScene {
  private readonly map: ReturnType<typeof createMap>;
  private readonly overlay: MapboxOverlay;
  private twinBuildings: readonly TwinBuilding[] = [];
  private floodSummary: FloodOutputSummary | null = null;
  private aoiBoundsWgs84: AoiBoundsWgs84 | null = null;
  private visibility: LayerVisibility = DEFAULT_VISIBILITY;

  constructor(container: HTMLElement, onMapClick: (result: MapClickResult) => void) {
    this.map = createMap(container);
    this.overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      onClick: (info): void => {
        const result = resolveMapClick(info);
        if (result) {
          onMapClick(result);
        }
      },
    });
    this.map.addControl(this.overlay);
  }

  setTwinBuildings(twinBuildings: readonly TwinBuilding[]): void {
    this.twinBuildings = twinBuildings;
    this.rebuildLayers();
  }

  /**
   * No-op: the invisible building-pick layer has no visible geometry to
   * restyle (§2/§7's own justification for retiring per-building
   * extrusion), and an opaque, streamed Google Photorealistic 3D Tiles
   * mesh cannot be selectively recolored per building. A real,
   * disclosed behavior change from the retired Cesium scene (which drew
   * a highlighted outline around the selected building) — recorded in
   * the Step 20 freeze audit as a known limitation, not silently
   * dropped. state/buildingState.ts's own selectedBuildingId still
   * drives panels/inspectionPanel.ts exactly as before; only the map's
   * own visual feedback is gone.
   */
  setSelectedBuilding(_buildingId: string | null): void {
    // Intentionally empty — see docstring above.
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
    const layers: Layer[] = [];

    const tilesLayer = createPhotorealisticTilesLayer(this.visibility.buildings3d);
    if (tilesLayer) {
      layers.push(tilesLayer);
    }

    layers.push(createBuildingPickLayer(this.twinBuildings));

    if (this.floodSummary && this.aoiBoundsWgs84) {
      layers.push(...createFloodLayers(this.floodSummary, this.aoiBoundsWgs84, this.visibility));
    }

    this.overlay.setProps({ layers });
  }
}
