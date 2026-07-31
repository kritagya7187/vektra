import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors';

/**
 * Mounted after every real route. An unmatched route is itself an error
 * condition — routing it through the same NotFoundError -> errorHandler
 * path (rather than a bespoke one-off 404 response) is what makes "a
 * single global error handler... consistent... across the backend" true
 * for every failure mode, not just the ones a controller explicitly
 * throws.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}`));
}
