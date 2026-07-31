import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rootLogger } from '../logging';
import { resolveLogLevelForStatus } from './logLevel';

const REQUEST_ID_HEADER = 'x-request-id';
const NANOS_PER_MS = 1_000_000;
const ROUNDING_PRECISION = 100; // 2 decimal places

function toRoundedMs(elapsedNanos: bigint): number {
  const ms = Number(elapsedNanos) / NANOS_PER_MS;
  return Math.round(ms * ROUNDING_PRECISION) / ROUNDING_PRECISION;
}

/**
 * Request-scoped context middleware.
 *
 * - Generates a request ID (never trusts a client-supplied one — no
 *   upstream gateway/proxy is described anywhere in the EDD's deployment
 *   architecture, so there is nothing to propagate a caller's ID from).
 * - Propagates it: attaches to req.id, binds it into a per-request child
 *   logger at req.log, and echoes it back via the X-Request-Id response
 *   header so a caller can correlate.
 * - Emits exactly one structured completion log line per request, once
 *   the response has finished, containing exactly the fields specified:
 *   method, path, status code, and execution time (timestamp, level, and
 *   request ID are carried automatically by the logger itself).
 */
export const requestContext: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  req.id = requestId;
  req.log = rootLogger.child({ requestId, type: 'request' });

  res.setHeader(REQUEST_ID_HEADER, requestId);

  res.on('finish', () => {
    const durationMs = toRoundedMs(process.hrtime.bigint() - startedAt);
    const level = resolveLogLevelForStatus(res.statusCode);

    req.log[level](
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      },
      'request completed',
    );
  });

  next();
};
