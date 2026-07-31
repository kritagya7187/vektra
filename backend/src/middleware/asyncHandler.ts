import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Express 4 does not automatically forward a rejected promise from an
 * async route/middleware handler to the error-handling pipeline — an
 * unhandled rejection results instead, bypassing errorHandler.ts
 * entirely. Every controller in this codebase will be written as an
 * async function; without this wrapper, the rest of this subsystem would
 * be silently defeated the first time one of them throws.
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
