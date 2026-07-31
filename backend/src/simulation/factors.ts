import type { MeteorologicalObservation } from '../models';
import type { FactorKey } from '../types';

/**
 * Pure, deterministic per-factor computation — no repository/database
 * access, extracted from HeatExposureSimulationService so it is directly
 * unit-testable, mirroring how ingestion/osm/geometry.ts and
 * parseOverpassResponse.ts were kept separate from OsmIngestionService's
 * own orchestration.
 *
 * See the Heat Exposure Engine engineering review for the full reasoning
 * behind which factors are computable at all: EDD Section 18 states no
 * equation is specified for the composite index, and none of the 5
 * candidate factors has a specified computation method either. Only ONE
 * is realized here (meteorological_context), using an already-real,
 * zero-invention value (a single raw ingested reading, applied uniformly
 * — the one approach Section 18 itself explicitly names). The other 4
 * are always marked not computable — this is not a temporary gap to be
 * filled by better code later, it is what "no equation is specified"
 * means today, generalized per heat_exposure_factor_value.is_computable's
 * own migration comment ("generalized here to any factor").
 *
 * morphology_density was initially implemented as computable (reporting
 * raw footprint area alone), then corrected after review: Section 18
 * defines this factor as footprint area AND local building density,
 * with height/levels conditionally added when available — area+density
 * together are the EDD's own stated floor, not area alone, and no
 * method for computing "local density" (no neighborhood radius/
 * algorithm is specified) exists to even reach that floor. Structurally
 * this factor is identical to exposure_shading (multiple named inputs,
 * no specified combination method), and the EDD's own resolution for
 * that identical structure is "not computable," not "report whichever
 * input happens to be available." Letting footprint area alone stand in
 * for the whole factor is itself an uncited methodological choice
 * (equivalent to an invented (area=1, density=0, height=0) weighting),
 * not a zero-invention fallback — the area computation itself is
 * uninvented, but using it to represent this factor is not.
 */

export interface MeteorologicalReading {
  readonly provenanceId: string;
  readonly observation: MeteorologicalObservation;
}

export interface FactorComputation {
  readonly isComputable: boolean;
  readonly factorValue: number | null;
  readonly notes: string;
}

const NOT_COMPUTABLE_NOTES: Readonly<Record<Exclude<FactorKey, 'meteorological_context'>, string>> =
  {
    thermal_signature:
      'Requires Landsat surface-temperature pixel values sampled at the building footprint. Only raster asset metadata (not pixel values) has been ingested (Remote Sensing Ingestion subsystem) — raster sampling/zonal statistics are out of scope for this engine.',
    vegetation_land_cover:
      'Requires ESA WorldCover classified pixel values at and around the building footprint. Only raster asset metadata (not classified pixel values) has been ingested — raster sampling/zonal statistics are out of scope for this engine.',
    morphology_density:
      "EDD Section 18 defines this factor as footprint area AND local building density (with height/levels added when available) — area and density together are the EDD's own stated minimum, not area alone. No method for computing 'local density' (no neighborhood radius or algorithm) is specified, so even that minimum cannot be reached without inventing a threshold. Reporting footprint area alone would itself be an uncited methodological choice, not a zero-invention fallback.",
    exposure_shading:
      'EDD Section 18 requires a sun-angle/shadow-geometry model combining building heights and the DEM; no such model is specified anywhere in the EDD, and inventing one is explicitly prohibited.',
  };

/**
 * EDD Section 18 explicitly permits "applied uniformly... across the
 * study area" — the single most recent reading for the caller-chosen
 * variable, copied verbatim to every building, with no averaging,
 * interpolation, or normalization.
 */
export function computeMeteorologicalContextFactor(
  reading: MeteorologicalReading | null,
): FactorComputation {
  if (reading === null) {
    return {
      isComputable: false,
      factorValue: null,
      notes:
        'No meteorological variable was specified for this run, or no matching Open-Meteo observation was found in the resolved batch.',
    };
  }
  const { observation } = reading;
  return {
    isComputable: true,
    factorValue: observation.variableValue,
    notes: `Raw value of the most recent '${observation.variableName}' observation (${observation.variableUnit}) in the resolved Open-Meteo batch, applied uniformly to every building per EDD Section 18. Observed at ${observation.observationTimestamp.toISOString()}.`,
  };
}

function notComputable(factorKey: Exclude<FactorKey, 'meteorological_context'>): FactorComputation {
  return {
    isComputable: false,
    factorValue: null,
    notes: NOT_COMPUTABLE_NOTES[factorKey],
  };
}

export function computeFactor(
  factorKey: FactorKey,
  meteorologicalReading: MeteorologicalReading | null,
): FactorComputation {
  switch (factorKey) {
    case 'meteorological_context':
      return computeMeteorologicalContextFactor(meteorologicalReading);
    case 'thermal_signature':
    case 'vegetation_land_cover':
    case 'morphology_density':
    case 'exposure_shading':
      return notComputable(factorKey);
  }
}
