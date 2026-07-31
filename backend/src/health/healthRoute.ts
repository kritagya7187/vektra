import type { Request, Response } from 'express';
import { checkDatabaseHealth } from '../database';

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * EDD Section 31: "basic health checks per containerized service."
 *
 * A single endpoint, not a liveness/readiness pair — see the Server
 * Bootstrap subsystem's design notes for why a separate readiness
 * endpoint isn't justified: Section 34 scopes deployment to Docker
 * Compose only, explicitly deferring Kubernetes-style orchestration
 * (where the liveness/readiness distinction actually matters) as a
 * Future Extension, and this service's readiness IS its database
 * connectivity — there's nothing a second endpoint would report that
 * this one doesn't already answer.
 *
 * 200 when connected and PostGIS is available; 503 otherwise, so a
 * container health check or load balancer can detect failure. Never
 * throws (checkDatabaseHealth() already guarantees that), so this
 * doesn't strictly need asyncHandler, but is wrapped with it anyway for
 * consistency with every other route handler in this codebase.
 */
export async function healthRoute(_req: Request, res: Response): Promise<void> {
  const database = await checkDatabaseHealth();
  const healthy = database.connected && database.postgis.available;

  res.status(healthy ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE).json({
    status: healthy ? 'ok' : 'unavailable',
    timestamp: new Date().toISOString(),
    database,
  });
}
