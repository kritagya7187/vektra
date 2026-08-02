import * as Cesium from 'cesium';
import {
  factorValueFor,
  normalize,
  thermalColorFor,
  type VisualizationRanges,
} from '../domain/colorRamps';
import { geometryCentroid } from '../domain/geometryCentroid';
import type { TwinBuilding } from '../domain/joinBuildingsWithResults';
import { ThermalFieldMaterialProperty } from './thermalFieldMaterial';

/**
 * Thermal-field visual redirect (Phase 2b) — the PRIMARY thermal signal
 * (per the approved design), a soft translucent halo around buildings
 * with a real, computable thermal_signature value. Deliberately a
 * SEPARATE class from BuildingLayer, not folded into it: BuildingLayer's
 * applyStyle() hard-assumes `entity.polygon` for every entity it
 * manages, and mixing a different graphics type into that map would
 * require branching a class whose existing reconciliation contract is
 * already load-bearing elsewhere (Comparison Mode's baseline/scenario
 * re-style). Mirrors the exact same id-diffing reconciliation shape
 * (setTwinBuildings re-styles in place, only creates/removes what
 * actually changed) as a proven, reused pattern — not a new one.
 *
 * Ground-draped `EllipseGraphics` (heightReference: CLAMP_TO_GROUND),
 * not a floating Ellipsoid/Cylinder — see thermalFieldMaterial.ts and
 * the approved plan for why (terrain z-fighting and shell rim-
 * brightening, both confirmed real problems with the floating-volume
 * alternative, checked directly against the installed Cesium types).
 *
 * Size AND opacity both scale continuously with the building's
 * normalized thermal intensity (colorRamps.ts's own normalize()) — a
 * cool building's halo is real but near-invisible, never a hard
 * threshold. Entities below MIN_VISIBLE_ALPHA are skipped entirely
 * (not worth a draw call for something nobody would see).
 */

export const THERMAL_FIELD_ENTITY_PREFIX = 'thermal-field:';

const MIN_RADIUS_M = 15;
const MAX_RADIUS_M = 45;
const MIN_ALPHA = 0.08;
const MAX_ALPHA = 0.38;
const MIN_VISIBLE_ALPHA = 0.03;

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

export class ThermalFieldLayer {
  private readonly viewer: Cesium.Viewer;
  private readonly entitiesByBuildingId = new Map<string, Cesium.Entity>();
  private enabled = true;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const entity of this.entitiesByBuildingId.values()) {
      entity.show = enabled;
    }
  }

  /**
   * Re-derives every halo from the real current twin-building set and
   * thermal range — same id-diffing shape as BuildingLayer.setTwinBuildings:
   * removes halos for buildings no longer present, updates existing
   * ones in place, creates only genuinely new ones.
   */
  setTwinBuildings(twinBuildings: readonly TwinBuilding[], ranges: VisualizationRanges): void {
    const nextIds = new Set<string>();

    if (ranges.thermal) {
      for (const twin of twinBuildings) {
        const value = factorValueFor(twin.factors, 'thermal_signature');
        if (value === null) {
          continue;
        }
        const intensity = normalize(value, ranges.thermal);
        const alpha = lerp(MIN_ALPHA, MAX_ALPHA, intensity);
        if (alpha < MIN_VISIBLE_ALPHA) {
          continue;
        }

        const buildingId = twin.building.buildingId;
        nextIds.add(buildingId);
        const radius = lerp(MIN_RADIUS_M, MAX_RADIUS_M, intensity);
        const colorCss = thermalColorFor(value, ranges.thermal);
        const color = Cesium.Color.fromCssColorString(colorCss).withAlpha(alpha);
        const centroid = geometryCentroid(twin.geometry);

        const existing = this.entitiesByBuildingId.get(buildingId);
        if (existing?.ellipse) {
          existing.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(centroid.lon, centroid.lat),
          );
          existing.ellipse.semiMajorAxis = new Cesium.ConstantProperty(radius);
          existing.ellipse.semiMinorAxis = new Cesium.ConstantProperty(radius);
          existing.ellipse.material = new ThermalFieldMaterialProperty(color);
          existing.show = this.enabled;
        } else {
          const entity = this.viewer.entities.add({
            id: `${THERMAL_FIELD_ENTITY_PREFIX}${buildingId}`,
            show: this.enabled,
            position: Cesium.Cartesian3.fromDegrees(centroid.lon, centroid.lat),
            ellipse: {
              semiMajorAxis: radius,
              semiMinorAxis: radius,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              material: new ThermalFieldMaterialProperty(color),
              fill: true,
              outline: false,
              shadows: Cesium.ShadowMode.DISABLED,
            },
          });
          this.entitiesByBuildingId.set(buildingId, entity);
        }
      }
    }

    for (const [buildingId, entity] of this.entitiesByBuildingId) {
      if (!nextIds.has(buildingId)) {
        this.viewer.entities.remove(entity);
        this.entitiesByBuildingId.delete(buildingId);
      }
    }
  }

  clear(): void {
    for (const entity of this.entitiesByBuildingId.values()) {
      this.viewer.entities.remove(entity);
    }
    this.entitiesByBuildingId.clear();
  }
}
