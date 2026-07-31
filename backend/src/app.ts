import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { apiRouter } from './api';
import { healthRoute } from './health';
import {
  asyncHandler,
  buildRateLimiter,
  corsOptionsDelegate,
  errorHandler,
  notFoundHandler,
  requestContext,
} from './middleware';

/**
 * Assembles a configured Express application. A factory, not a
 * module-level singleton — each call returns a fresh instance with no
 * shared state, which is what lets the eventual Tests subsystem exercise
 * the app without one test's middleware state leaking into another's.
 *
 * Never calls .listen() — that's server.ts's job. Keeping app assembly
 * separate from process binding is what makes this importable by an
 * HTTP-level test (e.g. supertest) without occupying a real port.
 *
 * Middleware order (see Subsystem 5 design notes for the full rationale
 * of each position):
 *   requestContext -> helmet -> cors -> compression -> rate limit
 *   (conditional) -> json body parsing -> routes (/health, /api/*) ->
 *   notFoundHandler -> errorHandler (always last)
 *
 * app.disable('x-powered-by') is not called separately — helmet already
 * removes that header by default; doing it twice would be duplicated
 * logic for the same guarantee.
 */
export function createApp(): Express {
  const app = express();

  app.use(requestContext);
  app.use(helmet());
  app.use(cors(corsOptionsDelegate));
  app.use(compression());

  const rateLimiter = buildRateLimiter();
  if (rateLimiter) {
    app.use(rateLimiter);
  }

  app.use(express.json());

  app.get('/health', asyncHandler(healthRoute));
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
