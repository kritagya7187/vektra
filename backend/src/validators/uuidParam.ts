import { z } from 'zod';
import { uuidSchema } from './primitives';

/**
 * The single most common param shape in this API — every resource-by-id
 * capability (buildings, simulation runs, provenance) takes a UUID path
 * param, matching the UUID primary keys used throughout db/migrations.
 */
export const uuidParamSchema = z.object({ id: uuidSchema });

export type UuidParam = z.infer<typeof uuidParamSchema>;
