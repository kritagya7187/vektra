import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { ValidationError, type ValidationIssue } from '../errors';
import { zodErrorToIssues } from '../validators';

export interface RequestSchemas<
  TParams extends ZodTypeAny = ZodTypeAny,
  TQuery extends ZodTypeAny = ZodTypeAny,
  TBody extends ZodTypeAny = ZodTypeAny,
> {
  readonly params?: TParams;
  readonly query?: TQuery;
  readonly body?: TBody;
}

/**
 * Validates params/query/body against the given Zod schemas, collecting
 * issues from ALL sections before failing — so a client fixing one
 * invalid field doesn't have to resubmit repeatedly to discover the
 * next one.
 *
 * On success: req.params/query/body are replaced (frozen) with the
 * validated, coerced, defaulted data. On failure: a single
 * ValidationError carrying every issue is forwarded to the existing
 * centralized error handler (Global Error Handling subsystem) via
 * next() — this middleware never builds an HTTP response itself, so the
 * stable JSON error envelope is never duplicated.
 *
 * See validators/types.ts's ValidatedRequest for how a controller
 * recovers proper static typing for req.params/query/body downstream —
 * Express 4 does not propagate this middleware's output type into the
 * next handler automatically.
 */
export function validateRequest<
  TParams extends ZodTypeAny = ZodTypeAny,
  TQuery extends ZodTypeAny = ZodTypeAny,
  TBody extends ZodTypeAny = ZodTypeAny,
>(
  schemas: RequestSchemas<TParams, TQuery, TBody>,
): RequestHandler<z.infer<TParams>, unknown, z.infer<TBody>, z.infer<TQuery>> {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: ValidationIssue[] = [];

    const paramsResult = schemas.params?.safeParse(req.params);
    if (paramsResult && !paramsResult.success) {
      issues.push(...zodErrorToIssues(paramsResult.error, 'params'));
    }

    const queryResult = schemas.query?.safeParse(req.query);
    if (queryResult && !queryResult.success) {
      issues.push(...zodErrorToIssues(queryResult.error, 'query'));
    }

    const bodyResult = schemas.body?.safeParse(req.body);
    if (bodyResult && !bodyResult.success) {
      issues.push(...zodErrorToIssues(bodyResult.error, 'body'));
    }

    if (issues.length > 0) {
      next(new ValidationError('Request validation failed.', issues));
      return;
    }

    if (paramsResult?.success) {
      req.params = Object.freeze(paramsResult.data) as typeof req.params;
    }
    if (queryResult?.success) {
      req.query = Object.freeze(queryResult.data) as typeof req.query;
    }
    if (bodyResult?.success) {
      const validatedBody: unknown = bodyResult.data;
      req.body = Object.freeze(validatedBody);
    }

    next();
  };
}
