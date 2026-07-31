import { z } from 'zod';
import { isoTimestampSchema, optionalQueryParam } from './primitives';

/**
 * Reusable from/to pair for any future endpoint needing a date-bounded
 * query. EDD Section 26 (Temporal Model) is explicit about distinguishing
 * observation/ingestion/computation time; this is generic infrastructure
 * for filtering by one of them, not tied to any specific one.
 */
export const dateRangeSchema = z
  .object({
    from: optionalQueryParam(isoTimestampSchema),
    to: optionalQueryParam(isoTimestampSchema),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be before or equal to to',
    path: ['from'],
  });

export type DateRange = z.infer<typeof dateRangeSchema>;
