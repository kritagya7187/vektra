import { z } from 'zod';
import { uuidSchema } from './primitives';

/**
 * Step 20 Part 0b: request validation for the new /api/flood-simulations
 * proxy routes. Structural validation only (required fields present,
 * correct types, coordinate ranges for the optional AOI bounds) --
 * per Step 19 Part D's "must not alter simulation parameters", nothing
 * here computes, defaults, or reinterprets a solver/timestepping value;
 * unvalidated fields pass straight through to
 * backend/src/floodEngine/client.ts unchanged.
 */

const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;

const solverParametersOverrideSchema = z
  .object({
    tolDelwlM: z.number().optional(),
    ignoreWdM: z.number().optional(),
    alpha: z.number().optional(),
    timeMindtS: z.number().optional(),
    timeMaxdtS: z.number().optional(),
  })
  .strict();

const timesteppingParametersOverrideSchema = z
  .object({
    infiltrationIntervalS: z.number().optional(),
  })
  .strict();

/** ``[west, south, east, north]`` in EPSG:4326 -- map-display metadata only, never a scientific parameter. */
const aoiBoundsWgs84Schema = z
  .tuple([
    z.number().min(MIN_LONGITUDE).max(MAX_LONGITUDE),
    z.number().min(MIN_LATITUDE).max(MAX_LATITUDE),
    z.number().min(MIN_LONGITUDE).max(MAX_LONGITUDE),
    z.number().min(MIN_LATITUDE).max(MAX_LATITUDE),
  ])
  .refine(([west, , east]) => west < east, { message: 'west must be less than east' })
  .refine(([, south, , north]) => south < north, { message: 'south must be less than north' });

/** GDAL affine 6-tuple (a, b, c, d, e, f) for elevationPath's grid -- map-display/GeoTIFF metadata only. */
const elevationTransformSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

export const submitFloodSimulationBodySchema = z.object({
  scenarioId: z.string().min(1, 'scenarioId must not be empty'),
  elevationPath: z.string().min(1, 'elevationPath must not be empty'),
  buildingMaskPath: z.string().min(1, 'buildingMaskPath must not be empty'),
  manningNPath: z.string().min(1, 'manningNPath must not be empty'),
  infiltrationLossPath: z.string().min(1, 'infiltrationLossPath must not be empty'),
  rainfallRatesPath: z.string().min(1, 'rainfallRatesPath must not be empty'),
  solverParameters: solverParametersOverrideSchema.optional(),
  timesteppingParameters: timesteppingParametersOverrideSchema.optional(),
  aoiBoundsWgs84: aoiBoundsWgs84Schema.optional(),
  elevationTransform: elevationTransformSchema.optional(),
  elevationCrsEpsg: z.number().int().optional(),
});

export type SubmitFloodSimulationBody = z.infer<typeof submitFloodSimulationBodySchema>;

export const floodSimulationRunIdParamSchema = z.object({ runId: uuidSchema });
export type FloodSimulationRunIdParam = z.infer<typeof floodSimulationRunIdParamSchema>;

const SIMULATION_ARTIFACTS = [
  'max-depth',
  'arrival-time',
  'duration-above-threshold',
  'max-depth-geotiff',
  'arrival-time-geotiff',
  'duration-above-threshold-geotiff',
] as const;

export const floodSimulationArtifactParamSchema = z.object({
  runId: uuidSchema,
  artifact: z.enum(SIMULATION_ARTIFACTS),
});
export type FloodSimulationArtifactParam = z.infer<typeof floodSimulationArtifactParamSchema>;
