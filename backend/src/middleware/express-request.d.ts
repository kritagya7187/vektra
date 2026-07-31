import type { Logger } from 'pino';

/**
 * Minimal ambient augmentation of Express's Request type, scoped to what
 * the logging subsystem attaches to every request: the generated request
 * ID and its request-scoped child logger.
 *
 * Deliberately colocated with middleware/ rather than the shared
 * src/types/ folder — src/types/ is reserved for the Domain Models &
 * Types subsystem (DB entity / DTO shapes); this augmentation is a
 * request-pipeline concern, not a domain model.
 */
declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
    }
  }
}

export {};
