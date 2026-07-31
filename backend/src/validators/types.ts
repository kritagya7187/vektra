import type { Request } from 'express';

/**
 * Convenience type alias for a Request whose params/query/body have been
 * validated by middleware/validateRequest().
 *
 * Honest limitation, stated explicitly: Express 4's type system does not
 * automatically propagate a middleware's output type into the next
 * handler in the same route's chain — `app.get(path, validateRequest(...),
 * handler)` does not make TypeScript infer handler's req type from the
 * validateRequest call. This alias is the resolution: a controller
 * declares its handler as (req: ValidatedRequest<P, Q, B>, res) => {...}
 * and mounts the matching validateRequest({ params, query, body }) schemas
 * on the same route. The runtime behavior and the declared type are kept
 * in sync by that convention, not verified automatically end-to-end by
 * the compiler.
 */
export type ValidatedRequest<TParams = unknown, TQuery = unknown, TBody = unknown> = Request<
  TParams,
  unknown,
  TBody,
  TQuery
>;
