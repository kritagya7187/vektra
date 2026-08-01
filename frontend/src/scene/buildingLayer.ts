import * as Cesium from 'cesium';
import type { GeoJsonMultiPolygon } from '../api';
import { extrusionHeightFor } from '../domain/extrusion';
import { SELECTED_OUTLINE_CSS, styleForResult, type BuildingStyle } from '../domain/styling';
import type { TwinBuilding } from '../domain/joinBuildingsWithResults';

export const BUILDING_ENTITY_PREFIX = 'building:';

function ringToPositions(ring: readonly (readonly [number, number])[]): Cesium.Cartesian3[] {
  const isClosed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const points = isClosed ? ring.slice(0, -1) : ring;
  const flat: number[] = [];
  for (const [lon, lat] of points) {
    flat.push(lon, lat);
  }
  return Cesium.Cartesian3.fromDegreesArray(flat);
}

/** A GeoJSON MultiPolygon may have more than one disjoint outer ring — Cesium's PolygonGraphics holds exactly one hierarchy, so a multi-part building becomes one Entity per polygon, all tagged with the same buildingId for selection purposes. */
function multiPolygonToHierarchies(geometry: GeoJsonMultiPolygon): Cesium.PolygonHierarchy[] {
  return geometry.coordinates.map((polygonRings) => {
    const [outer, ...holes] = polygonRings;
    const outerPositions = ringToPositions(outer);
    const holeHierarchies = holes.map((hole) => new Cesium.PolygonHierarchy(ringToPositions(hole)));
    return new Cesium.PolygonHierarchy(outerPositions, holeHierarchies);
  });
}

function applyStyle(entity: Cesium.Entity, style: BuildingStyle, selected: boolean): void {
  if (!entity.polygon) {
    return;
  }
  entity.polygon.material = new Cesium.ColorMaterialProperty(
    Cesium.Color.fromCssColorString(style.fillColorCss).withAlpha(0.85),
  );
  entity.polygon.outlineColor = new Cesium.ConstantProperty(
    Cesium.Color.fromCssColorString(selected ? SELECTED_OUTLINE_CSS : style.outlineColorCss),
  );
  entity.polygon.outlineWidth = new Cesium.ConstantProperty(selected ? 3 : 1);
}

function createEntitiesForBuilding(
  twinBuilding: TwinBuilding,
  style: BuildingStyle,
): Cesium.Entity.ConstructorOptions[] {
  const hierarchies = multiPolygonToHierarchies(twinBuilding.geometry);
  const extrudedHeight = extrusionHeightFor(twinBuilding.building);

  return hierarchies.map((hierarchy) => ({
    id: `${BUILDING_ENTITY_PREFIX}${twinBuilding.building.buildingId}`,
    polygon: {
      hierarchy,
      height: 0,
      extrudedHeight,
      material: Cesium.Color.fromCssColorString(style.fillColorCss).withAlpha(0.85),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString(style.outlineColorCss),
      outlineWidth: 1,
      closeTop: true,
      closeBottom: true,
    },
  }));
}

/**
 * Owns every building Entity in the scene. Design review §14/"Reuse
 * Entities" — setTwinBuildings() reconciles by buildingId: entities for
 * buildings no longer present are removed, entities for buildings
 * already present are re-styled in place (no remove+re-add), and only
 * genuinely new buildings get new entities. This matters most for
 * Comparison Mode (§5D): toggling baseline vs scenario styling touches
 * the SAME building set, so it is a pure re-style, not a scene rebuild.
 */
export class BuildingLayer {
  private readonly viewer: Cesium.Viewer;
  private readonly entitiesByBuildingId = new Map<string, Cesium.Entity[]>();
  private readonly twinByBuildingId = new Map<string, TwinBuilding>();
  private selectedBuildingId: string | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  setTwinBuildings(twinBuildings: readonly TwinBuilding[]): void {
    const nextIds = new Set(twinBuildings.map((tb) => tb.building.buildingId));

    for (const [buildingId, entities] of this.entitiesByBuildingId) {
      if (!nextIds.has(buildingId)) {
        for (const entity of entities) {
          this.viewer.entities.remove(entity);
        }
        this.entitiesByBuildingId.delete(buildingId);
        this.twinByBuildingId.delete(buildingId);
      }
    }

    for (const twinBuilding of twinBuildings) {
      const buildingId = twinBuilding.building.buildingId;
      const style = styleForResult(twinBuilding.result);
      const selected = buildingId === this.selectedBuildingId;
      const existing = this.entitiesByBuildingId.get(buildingId);

      if (existing) {
        for (const entity of existing) {
          applyStyle(entity, style, selected);
        }
      } else {
        const created = createEntitiesForBuilding(twinBuilding, style).map((options) =>
          this.viewer.entities.add(options),
        );
        for (const entity of created) {
          applyStyle(entity, style, selected);
        }
        this.entitiesByBuildingId.set(buildingId, created);
      }
      this.twinByBuildingId.set(buildingId, twinBuilding);
    }
  }

  setSelected(buildingId: string | null): void {
    const previous = this.selectedBuildingId;
    this.selectedBuildingId = buildingId;

    if (previous !== null) {
      const twin = this.twinByBuildingId.get(previous);
      const entities = this.entitiesByBuildingId.get(previous);
      if (twin && entities) {
        const style = styleForResult(twin.result);
        for (const entity of entities) {
          applyStyle(entity, style, false);
        }
      }
    }
    if (buildingId !== null) {
      const twin = this.twinByBuildingId.get(buildingId);
      const entities = this.entitiesByBuildingId.get(buildingId);
      if (twin && entities) {
        const style = styleForResult(twin.result);
        for (const entity of entities) {
          applyStyle(entity, style, true);
        }
      }
    }
  }

  buildingIdForEntity(entity: Cesium.Entity): string | null {
    const id = String(entity.id);
    return id.startsWith(BUILDING_ENTITY_PREFIX) ? id.slice(BUILDING_ENTITY_PREFIX.length) : null;
  }

  hasBuildings(): boolean {
    return this.entitiesByBuildingId.size > 0;
  }

  allEntities(): readonly Cesium.Entity[] {
    return [...this.entitiesByBuildingId.values()].flat();
  }

  clear(): void {
    for (const entities of this.entitiesByBuildingId.values()) {
      for (const entity of entities) {
        this.viewer.entities.remove(entity);
      }
    }
    this.entitiesByBuildingId.clear();
    this.twinByBuildingId.clear();
    this.selectedBuildingId = null;
  }
}
