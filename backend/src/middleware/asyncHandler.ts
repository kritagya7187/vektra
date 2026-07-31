import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler<P = unknown, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown> = (
  req: Request<P, ResBody, ReqBody, ReqQuery>,
  res: Response<ResBody>,
  next: NextFunction,
) => Promise<void>;

/**
 * Express 4 does not automatically forward a rejected promise from an
 * async route/middleware handler to the error-handling pipeline — an
 * unhandled rejection results instead, bypassing errorHandler.ts
 * entirely. Every controller in this codebase is written as an async
 * function; without this wrapper, the rest of this subsystem would be
 * silently defeated the first time one of them throws.
 *
 * Generic over P/ResBody/ReqBody/ReqQuery — added in the Controllers
 * subsystem once a real caller needed it: the original non-generic
 * version (health route only) forced every handler's req down to
 * Express's untyped default shape, which is incompatible with
 * validators/types.ts's ValidatedRequest<TParams, TQuery, TBody> (the
 * documented convention for recovering static typing after
 * validateRequest()). Inferred from whatever handler is passed in, so
 * existing non-generic callers (healthRoute) are unaffected.
 */
export function asyncHandler<P = unknown, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(
  fn: AsyncRequestHandler<P, ResBody, ReqBody, ReqQuery>,
): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
