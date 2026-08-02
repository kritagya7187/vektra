import * as Cesium from 'cesium';

/**
 * Thermal-field visual redirect (Phase 2b spike) — a custom Cesium
 * Fabric material doing a radial alpha falloff (soft at the center,
 * fading to fully transparent at the shape's own edge), since no stock
 * Cesium material in this version does this (confirmed: every
 * `*MaterialProperty` class in node_modules/cesium/Source/Cesium.d.ts
 * was checked, none offer a radial gradient for polygon/ellipse fill).
 *
 * The registration mechanism below was confirmed against the REAL
 * installed Cesium bundle (node_modules/cesium/Build/CesiumUnminified/
 * Cesium.js), not assumed: `Material`'s constructor (`initializeMaterial`
 * internally) auto-registers a fabric template into Cesium's material
 * cache the first time it's constructed with a given `fabric.type`, if
 * that type isn't already cached — the same real code path Cesium's own
 * built-in materials (Color, Image, PolylineGlow, ...) go through.
 * Constructing one throwaway `Material` at module load triggers that
 * real registration, via the fully public, typed `Material` constructor
 * (`fabric: any`) — deliberately NOT reaching into the private,
 * undocumented `Material._materialCache` field directly, which isn't
 * even present in the public type definitions.
 *
 * `components.alpha`'s GLSL expression uses only two universal GLSL ES
 * 1.00 builtins (`distance`, `smoothstep`) against `materialInput.st`
 * (confirmed real and present on this exact interpolation input by
 * reading Cesium's own built-in `Image`/`DiffuseMap` material fabrics,
 * which use it identically) — chosen specifically to be the simplest,
 * lowest-risk correct GLSL achievable, since this environment has no
 * way to visually render and debug a shader.
 */

const MATERIAL_TYPE = 'VektraThermalRadialField';
let materialTypeRegistered = false;

function ensureMaterialTypeRegistered(): void {
  if (materialTypeRegistered) {
    return;
  }
  // Result intentionally unused — constructing this is what registers
  // MATERIAL_TYPE into Cesium's material cache as a side effect; every
  // later ThermalFieldMaterialProperty just references the type by name.
  new Cesium.Material({
    fabric: {
      type: MATERIAL_TYPE,
      uniforms: {
        color: Cesium.Color.WHITE.withAlpha(0.3),
      },
      components: {
        diffuse: 'color.rgb',
        alpha: 'color.a * (1.0 - smoothstep(0.0, 0.5, distance(materialInput.st, vec2(0.5, 0.5))))',
      },
    },
    translucent: true,
  });
  materialTypeRegistered = true;
}

/**
 * One instance per halo entity — `color` (including its real alpha,
 * itself derived from the building's normalized thermal intensity) is
 * the only real per-building input; everything else is the shared
 * fabric template registered once above. Static, not time-varying
 * (`isConstant: true`) — matches this codebase's own non-animated
 * conventions (see domain/colorRamps.ts, no animation anywhere in this
 * redesign).
 */
export class ThermalFieldMaterialProperty {
  readonly isConstant = true;
  readonly definitionChanged = new Cesium.Event();
  private readonly color: Cesium.Color;

  constructor(color: Cesium.Color) {
    ensureMaterialTypeRegistered();
    this.color = color;
  }

  getType(): string {
    return MATERIAL_TYPE;
  }

  getValue(): { color: Cesium.Color } {
    // Always a fresh object — colors are per-entity-static and cheap to
    // allocate; not worth the result-object-reuse complexity every other
    // getValue() implementation in Cesium itself takes on for
    // time-varying properties, which this one deliberately isn't.
    return { color: Cesium.Color.clone(this.color) };
  }

  equals(other?: unknown): boolean {
    return (
      other instanceof ThermalFieldMaterialProperty && Cesium.Color.equals(this.color, other.color)
    );
  }
}
