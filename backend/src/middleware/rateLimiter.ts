import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { config } from '../config';

/**
 * Disabled by default (project constraint). Returns null — not a no-op
 * middleware — when disabled, so app.ts can choose not to register
 * anything at all rather than registering a middleware that does
 * nothing; the absence of rate limiting in the chain is then visible
 * directly in app.ts, not hidden inside this function.
 *
 * When enabled, both thresholds come from config.rateLimit — already
 * validated at startup (Foundation subsystem) to both be present with no
 * fallback default, so there is no hard-coded threshold anywhere in this
 * file.
 */
export function buildRateLimiter(): RateLimitRequestHandler | null {
  if (!config.rateLimit.enabled) {
    return null;
  }

  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
  });
}
