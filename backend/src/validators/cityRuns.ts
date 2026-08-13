import { z } from 'zod';

/**
 * City-scale run ids are timestamp-based directory names
 * (`mumbai-20260813T154557Z`), not UUIDs — a distinct id shape from
 * every other resource in this API. The charset matches flood-engine's
 * own `_RUN_ID_PATTERN` guard against path traversal.
 */
const runIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, 'runId must contain only letters, digits, "-" and "_"');

export const cityRunIdParamSchema = z.object({ runId: runIdSchema });

export type CityRunIdParam = z.infer<typeof cityRunIdParamSchema>;

const CITY_RUN_ARTIFACTS = [
  'max-depth-geotiff',
  'arrival-time-geotiff',
  'duration-above-threshold-geotiff',
] as const;

export const cityRunArtifactParamSchema = z.object({
  runId: runIdSchema,
  artifact: z.enum(CITY_RUN_ARTIFACTS),
});

export type CityRunArtifactParam = z.infer<typeof cityRunArtifactParamSchema>;
