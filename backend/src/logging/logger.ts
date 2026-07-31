import pino, { type Logger } from 'pino';
import { config } from '../config';
import { REDACTION_CENSOR, SENSITIVE_LOG_PATHS } from './redaction';

/**
 * The single root Pino logger for this service.
 *
 * - Level is configuration-driven (config.logging.level), never hard-coded
 *   (EDD instruction: "Log configuration through environment variables only").
 * - `base: { service: 'vektra-backend' }` implements EDD Section 30's
 *   "structured logging per subsystem, distinguishing... API/backend
 *   logs" — every line is tagged as belonging to this service.
 * - Output is always structured JSON, in every environment. No
 *   pretty-printing transform is applied, so "structured JSON logging" is
 *   guaranteed rather than only true in production.
 * - Redaction is configured here once, so it applies to every logger
 *   derived from this instance (including per-request child loggers)
 *   automatically.
 */
export const rootLogger: Logger = pino({
  level: config.logging.level,
  base: { service: 'vektra-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: SENSITIVE_LOG_PATHS,
    censor: REDACTION_CENSOR,
  },
});
