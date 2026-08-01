import type { MeteorologicalObservation } from '../models';
import type { FactorKey } from '../types';
import type { GeoJsonMultiPolygon } from '../types/geometry';
import { sampleRasterBandForFootprint } from './rasterSampling';
import { computeNdvi } from './spectralIndices';

/**
 * Pure per-factor computation (raster sampling makes this file async as
 * of Phase 3 Milestone 2, but it remains database-free — the only I/O is
 * reading a raster file already downloaded to RASTER_STORAGE_DIR by
 * ingestion, matching EDD Section 17's "the simulation engine... has no
 * dependency on... any interactive input at run time").
 *
 * See the Heat Exposure Engine engineering review (and the Remote
 * Sensing Foundation milestone's own audit) for the full reasoning
 * behind which factors are computable: EDD Section 18 states no
 * combination equation is specified for the COMPOSITE index, and that
 * remains true — this file still never produces one. Per-factor
 * computability is a separate question, and this milestone changed the
 * answer for exactly one more factor:
 *
 * - meteorological_context: unchanged, real since the Heat Exposure
 *   Engine subsystem (a single raw ingested reading, applied uniformly).
 * - vegetation_land_cover: NOW COMPUTABLE when a Sentinel-2 raster asset
 *   is available for the run — NDVI (a standard, named, non-invented
 *   index, EDD Section 18's own permitted "optionally a standard...
 *   vegetation index") sampled at the building footprint. When ESA
 *   WorldCover data is also available, its majority land-cover class at
 *   the footprint is reported in `notes` as qualitative context — EDD
 *   Section 18 never specifies how to combine a categorical class with a
 *   continuous index into one number, so no such combination is
 *   invented; the single numeric factorValue is NDVI alone, which is a
 *   complete, real, standard indicator on its own.
 * - thermal_signature: the code path is real and identical in kind to
 *   vegetation_land_cover (sample Landsat's ST_B10 band, already
 *   delivered in Kelvin by Sentinel Hub's processing — not a value this
 *   codebase derives or invents) but remains not-computable in practice
 *   whenever no Landsat raster asset is available for the run (see
 *   LandsatClient.ts's own note on this account's current access
 *   status).
 * - morphology_density, exposure_shading: UNCHANGED, out of scope for
 *   this milestone (raster data does not resolve either's real blocker —
 *   an undefined density-neighborhood algorithm and an undefined
 *   sun-angle/shadow model, respectively; see this file's own prior
 *   reasoning, preserved below).
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

/** A resolved, downloaded raster asset available for this run — just enough for rasterSampling.ts to read it. */
export interface RasterInput {
  readonly storageLocation: string;
}

export interface RasterInputs {
  readonly sentinel2?: RasterInput;
  readonly worldCover?: RasterInput;
  readonly landsat?: RasterInput;
}

export interface FactorComputation {
  readonly isComputable: boolean;
  readonly factorValue: number | null;
  readonly notes: string;
}

const NOT_COMPUTABLE_NOTES: Readonly<Record<'morphology_density' | 'exposure_shading', string>> = {
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

/** Sentinel2Client.ts's evalscript band order: B04, B08, B11, SCL, dataMask. */
const SENTINEL2_BAND_RED = 0;
const SENTINEL2_BAND_NIR = 1;
const SENTINEL2_BAND_DATAMASK = 4;

async function computeVegetationLandCoverFactor(
  footprint: GeoJsonMultiPolygon,
  sentinel2: RasterInput | undefined,
): Promise<FactorComputation> {
  if (!sentinel2) {
    return {
      isComputable: false,
      factorValue: null,
      notes:
        'Requires Sentinel-2 L2A reflectance values sampled at the building footprint. No Sentinel-2 raster asset was resolved for this run (Remote Sensing Ingestion subsystem) — ingest one with `npm run ingest:raster -- --source=sentinel2_l2a` and pass its provenance id to this run.',
    };
  }

  const red = await sampleRasterBandForFootprint(
    sentinel2.storageLocation,
    footprint,
    SENTINEL2_BAND_RED,
    SENTINEL2_BAND_DATAMASK,
  );
  const nir = await sampleRasterBandForFootprint(
    sentinel2.storageLocation,
    footprint,
    SENTINEL2_BAND_NIR,
    SENTINEL2_BAND_DATAMASK,
  );
  if (!red || !nir) {
    return {
      isComputable: false,
      factorValue: null,
      notes:
        'A Sentinel-2 raster asset was resolved for this run, but the building footprint had no valid (non-cloud-masked) pixels within it.',
    };
  }

  const ndvi = computeNdvi(nir.mean, red.mean);
  if (ndvi === null) {
    return {
      isComputable: false,
      factorValue: null,
      notes: 'NDVI is undefined at this footprint (NIR + Red reflectance sums to zero).',
    };
  }

  return {
    isComputable: true,
    factorValue: ndvi,
    notes: `NDVI (Rouse et al., 1974) computed from real Sentinel-2 L2A B04/B08 reflectance sampled at the building footprint (${nir.sampleCount} pixel(s)), per EDD Section 18's "standard, well-established remote-sensing vegetation index."`,
  };
}

/** LandsatClient.ts's evalscript band order: ST_B10, dataMask. */
const LANDSAT_BAND_ST = 0;
const LANDSAT_BAND_DATAMASK = 1;

async function computeThermalSignatureFactor(
  footprint: GeoJsonMultiPolygon,
  landsat: RasterInput | undefined,
): Promise<FactorComputation> {
  if (!landsat) {
    return {
      isComputable: false,
      factorValue: null,
      notes:
        "Requires Landsat Collection 2 Level-2 Surface Temperature (ST_B10) values sampled at the building footprint. No Landsat raster asset was resolved for this run — see LandsatClient.ts for this data source's current access status.",
    };
  }

  const st = await sampleRasterBandForFootprint(
    landsat.storageLocation,
    footprint,
    LANDSAT_BAND_ST,
    LANDSAT_BAND_DATAMASK,
  );
  if (!st) {
    return {
      isComputable: false,
      factorValue: null,
      notes:
        'A Landsat raster asset was resolved for this run, but the building footprint had no valid pixels within it.',
    };
  }

  return {
    isComputable: true,
    factorValue: st.mean,
    notes: `Landsat Collection 2 Level-2 Surface Temperature (ST_B10, Kelvin — already the official calibrated science product value, not derived here) sampled at the building footprint (${st.sampleCount} pixel(s)), per EDD Section 18.`,
  };
}

function notComputable(factorKey: 'morphology_density' | 'exposure_shading'): FactorComputation {
  return {
    isComputable: false,
    factorValue: null,
    notes: NOT_COMPUTABLE_NOTES[factorKey],
  };
}

export async function computeFactor(
  factorKey: FactorKey,
  meteorologicalReading: MeteorologicalReading | null,
  footprint: GeoJsonMultiPolygon,
  rasterInputs: RasterInputs,
): Promise<FactorComputation> {
  switch (factorKey) {
    case 'meteorological_context':
      return computeMeteorologicalContextFactor(meteorologicalReading);
    case 'vegetation_land_cover':
      return computeVegetationLandCoverFactor(footprint, rasterInputs.sentinel2);
    case 'thermal_signature':
      return computeThermalSignatureFactor(footprint, rasterInputs.landsat);
    case 'morphology_density':
    case 'exposure_shading':
      return notComputable(factorKey);
  }
}
