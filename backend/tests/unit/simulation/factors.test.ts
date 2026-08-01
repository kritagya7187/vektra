import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeArrayBuffer } from 'geotiff';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeFactor,
  computeMeteorologicalContextFactor,
  type MeteorologicalReading,
  type RasterInputs,
} from '../../../src/simulation/factors';
import type { MeteorologicalObservation } from '../../../src/models';
import type { GeoJsonMultiPolygon } from '../../../src/types/geometry';

const BASE_OBSERVATION: MeteorologicalObservation = {
  metObservationId: 'obs1',
  sourceCode: 'open_meteo',
  observationTimestamp: new Date('2025-06-01T12:00:00Z'),
  location: { type: 'Point', coordinates: [72.8317, 18.925] },
  variableName: 'temperature_2m',
  variableValue: 31.4,
  variableUnit: '°C',
  provenanceId: 'prov-met-1',
  createdAt: new Date('2025-06-01T12:05:00Z'),
  updatedAt: new Date('2025-06-01T12:05:00Z'),
};

/** A tiny real footprint sitting entirely within the tiny real fixture rasters built below. */
const FOOTPRINT: GeoJsonMultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [72.8, 18.9],
        [72.8004, 18.9],
        [72.8004, 18.9004],
        [72.8, 18.9004],
        [72.8, 18.9],
      ],
    ],
  ],
};

const NO_RASTER_INPUTS: RasterInputs = {};

describe('computeMeteorologicalContextFactor', () => {
  it('reports the raw observation value verbatim when a reading is provided', () => {
    const reading: MeteorologicalReading = {
      provenanceId: 'prov-met-1',
      observation: BASE_OBSERVATION,
    };
    const result = computeMeteorologicalContextFactor(reading);
    expect(result.isComputable).toBe(true);
    expect(result.factorValue).toBe(31.4);
    expect(result.notes).toContain('temperature_2m');
    expect(result.notes).toContain('°C');
  });

  it('marks not computable when no reading was resolved', () => {
    const result = computeMeteorologicalContextFactor(null);
    expect(result.isComputable).toBe(false);
    expect(result.factorValue).toBeNull();
  });

  it('applies the exact same raw value uniformly regardless of which building it is applied for (no per-building variation, no invented interpolation)', () => {
    const reading: MeteorologicalReading = {
      provenanceId: 'prov-met-1',
      observation: BASE_OBSERVATION,
    };
    const a = computeMeteorologicalContextFactor(reading);
    const b = computeMeteorologicalContextFactor(reading);
    expect(a.factorValue).toBe(b.factorValue);
  });
});

describe('computeFactor — no raster/meteorological input available', () => {
  const alwaysNotComputable = ['morphology_density', 'exposure_shading'] as const;

  it.each(alwaysNotComputable)(
    '%s is never computable regardless of input (no methodology exists at all — EDD Section 18)',
    async (factorKey) => {
      const result = await computeFactor(factorKey, null, FOOTPRINT, NO_RASTER_INPUTS);
      expect(result.isComputable).toBe(false);
      expect(result.factorValue).toBeNull();
      expect(result.notes.length).toBeGreaterThan(0);
    },
  );

  it("morphology_density's note explains the EDD's own floor (area AND density) is unmet, not just that the full concept is incomplete", async () => {
    const result = await computeFactor('morphology_density', null, FOOTPRINT, NO_RASTER_INPUTS);
    expect(result.notes).toContain('density');
    expect(result.notes.toLowerCase()).toContain('minimum');
  });

  it('vegetation_land_cover and thermal_signature are not computable when no matching raster asset was resolved for the run', async () => {
    const vegetation = await computeFactor(
      'vegetation_land_cover',
      null,
      FOOTPRINT,
      NO_RASTER_INPUTS,
    );
    const thermal = await computeFactor('thermal_signature', null, FOOTPRINT, NO_RASTER_INPUTS);
    expect(vegetation.isComputable).toBe(false);
    expect(thermal.isComputable).toBe(false);
    expect(vegetation.notes.length).toBeGreaterThan(0);
    expect(thermal.notes.length).toBeGreaterThan(0);
  });

  it('routes only meteorological_context to a computable implementation when no raster input exists', async () => {
    const reading: MeteorologicalReading = {
      provenanceId: 'prov-met-1',
      observation: BASE_OBSERVATION,
    };
    expect(
      (await computeFactor('meteorological_context', reading, FOOTPRINT, NO_RASTER_INPUTS))
        .isComputable,
    ).toBe(true);
    expect(
      (await computeFactor('morphology_density', reading, FOOTPRINT, NO_RASTER_INPUTS))
        .isComputable,
    ).toBe(false);
    expect(
      (await computeFactor('thermal_signature', reading, FOOTPRINT, NO_RASTER_INPUTS)).isComputable,
    ).toBe(false);
    expect(
      (await computeFactor('vegetation_land_cover', reading, FOOTPRINT, NO_RASTER_INPUTS))
        .isComputable,
    ).toBe(false);
    expect(
      (await computeFactor('exposure_shading', reading, FOOTPRINT, NO_RASTER_INPUTS)).isComputable,
    ).toBe(false);
  });
});

/**
 * Real fixture rasters, not mocks: genuine GeoTIFF bytes built with
 * geotiff.js's own writeArrayBuffer (the same real function
 * EsaWorldCoverClient.ts uses), read back by the real
 * sampleRasterBandForFootprint() (rasterSampling.ts) exactly the way a
 * live-downloaded raster would be. Proves the actual wiring
 * (factors.ts -> rasterSampling.ts -> geotiff.js -> spectralIndices.ts),
 * not just each piece in isolation.
 */
describe('computeFactor — real raster input available', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'vektra-factors-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function writeFixtureRaster(fileName: string, bandValues: readonly number[][]): string {
    // 2x2 pixel raster covering [72.8, 18.9, 72.8004, 18.9004] — the same
    // extent FOOTPRINT sits inside, so every pixel center falls inside it.
    //
    // Deliberately NOT using writeArrayBuffer's documented 3D-array input
    // shape (Array<Array<Array<number>>>, band -> row -> col) — real
    // testing found a genuine limitation in geotiff.js's writer
    // (node_modules/geotiff/src/geotiffwriter.js): for BOTH of its
    // documented multi-value input shapes, the internal `flattenedValues`
    // stays a plain JS array, never a TypedArray. encodeImage() then
    // branches on `values.constructor.name` — a plain array's
    // constructor name is "Array", which matches no case in its typeMap,
    // so it silently falls back to writing each value as one raw byte
    // (Uint8Array truncation) instead of a real 32-bit float. Every
    // fractional value (e.g. NDVI band reflectances like 0.1, 0.5) was
    // silently truncated to 0 — confirmed by a standalone diagnostic
    // script reading a written fixture back and finding every pixel 0.
    // The fix: pass an ACTUAL Float32Array as the flat single-level
    // input — the writer's `isFlattened` branch (data[0] is a number)
    // keeps that exact TypedArray all the way to encodeImage, which then
    // correctly matches "Float32Array" and encodes real IEEE floats.
    const filePath = path.join(tempDir, fileName);
    const numBands = bandValues.length;
    const width = 2;
    const height = 2;
    // Interleaved (PlanarConfiguration=1, "chunky"), matching this exact
    // writer's own interleaving order for the 3D-array path (row -> col
    // -> band) it never itself produced correctly.
    const interleaved = new Float32Array(width * height * numBands);
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        for (let band = 0; band < numBands; band += 1) {
          interleaved[(row * width + col) * numBands + band] = bandValues[band][row * width + col];
        }
      }
    }
    const buffer = writeArrayBuffer(interleaved, {
      width,
      height,
      SamplesPerPixel: numBands,
      BitsPerSample: bandValues.map(() => 32),
      SampleFormat: bandValues.map(() => 3), // IEEE float
      ModelPixelScale: [0.0002, 0.0002, 0],
      ModelTiepoint: [0, 0, 0, 72.8, 18.9004, 0],
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 1,
      GeographicTypeGeoKey: 4326,
    });
    writeFileSync(filePath, Buffer.from(buffer));
    return filePath;
  }

  it('vegetation_land_cover becomes computable: real NDVI from real sampled Sentinel-2-shaped bands', async () => {
    // Band order matches Sentinel2Client.ts's evalscript: B04, B08, B11, SCL, dataMask.
    const red = [0.1, 0.1, 0.1, 0.1];
    const nir = [0.5, 0.5, 0.5, 0.5];
    const swir = [0.2, 0.2, 0.2, 0.2];
    const scl = [4, 4, 4, 4];
    const dataMask = [1, 1, 1, 1];
    const filePath = writeFixtureRaster('sentinel2.tif', [red, nir, swir, scl, dataMask]);

    const result = await computeFactor('vegetation_land_cover', null, FOOTPRINT, {
      sentinel2: { storageLocation: filePath },
    });

    expect(result.isComputable).toBe(true);
    // NDVI = (nir - red) / (nir + red) = (0.5 - 0.1) / (0.5 + 0.1)
    expect(result.factorValue).toBeCloseTo((0.5 - 0.1) / (0.5 + 0.1), 6);
    expect(result.notes).toContain('NDVI');
  });

  it('thermal_signature becomes computable: real Kelvin ST value from a real sampled Landsat-shaped band', async () => {
    // Band order matches LandsatClient.ts's evalscript: ST_B10, dataMask.
    const stKelvin = [305.2, 305.2, 305.2, 305.2];
    const dataMask = [1, 1, 1, 1];
    const filePath = writeFixtureRaster('landsat.tif', [stKelvin, dataMask]);

    const result = await computeFactor('thermal_signature', null, FOOTPRINT, {
      landsat: { storageLocation: filePath },
    });

    expect(result.isComputable).toBe(true);
    expect(result.factorValue).toBeCloseTo(305.2, 3);
    expect(result.notes).toContain('Kelvin');
  });

  it('vegetation_land_cover is not computable when every sampled pixel is cloud/no-data masked', async () => {
    const red = [0.1, 0.1, 0.1, 0.1];
    const nir = [0.5, 0.5, 0.5, 0.5];
    const swir = [0.2, 0.2, 0.2, 0.2];
    const scl = [9, 9, 9, 9]; // cloud
    const dataMask = [0, 0, 0, 0]; // masked out
    const filePath = writeFixtureRaster('sentinel2-masked.tif', [red, nir, swir, scl, dataMask]);

    const result = await computeFactor('vegetation_land_cover', null, FOOTPRINT, {
      sentinel2: { storageLocation: filePath },
    });

    expect(result.isComputable).toBe(false);
  });

  it('is deterministic: identical real raster input always produces identical output', async () => {
    const filePath = writeFixtureRaster('sentinel2-det.tif', [
      [0.15, 0.15, 0.15, 0.15],
      [0.45, 0.45, 0.45, 0.45],
      [0.2, 0.2, 0.2, 0.2],
      [4, 4, 4, 4],
      [1, 1, 1, 1],
    ]);
    const rasterInputs: RasterInputs = { sentinel2: { storageLocation: filePath } };

    const first = await computeFactor('vegetation_land_cover', null, FOOTPRINT, rasterInputs);
    const second = await computeFactor('vegetation_land_cover', null, FOOTPRINT, rasterInputs);
    expect(second).toEqual(first);
  });
});
