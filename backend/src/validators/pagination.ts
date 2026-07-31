import { z } from 'zod';
import { integerSchema, optionalQueryParam } from './primitives';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MIN_LIMIT = 1;
const DEFAULT_OFFSET = 0;
const MIN_OFFSET = 0;

/**
 * limit/offset is chosen as the least-surprising REST convention — not
 * an EDD requirement (Section 21 names no pagination mechanism at all).
 * Built here as reusable infrastructure per this subsystem's explicit
 * scope; no endpoint in this codebase applies it. Whether any given
 * future endpoint needs pagination at all remains that endpoint's own
 * decision (Controllers subsystem), not assumed here.
 */
export const paginationSchema = z.object({
  limit: optionalQueryParam(integerSchema({ min: MIN_LIMIT, max: MAX_LIMIT })).default(
    DEFAULT_LIMIT,
  ),
  offset: optionalQueryParam(integerSchema({ min: MIN_OFFSET })).default(DEFAULT_OFFSET),
});

export type Pagination = z.infer<typeof paginationSchema>;
