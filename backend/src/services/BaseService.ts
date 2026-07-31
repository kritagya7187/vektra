import type { Logger } from 'pino';
import { NotFoundError } from '../errors';
import { rootLogger } from '../logging';

/**
 * Shared service-layer base: logger DI following the exact pattern
 * BaseRepository established (constructor-injected, defaulting to a
 * `rootLogger.child({...})` instance), plus one small helper for the
 * "existence validation" business rule every read-oriented service
 * needs (item 3 of this subsystem's brief).
 *
 * Deliberately does NOT provide query-execution helpers the way
 * BaseRepository does — services never execute queries themselves, only
 * repository methods, so there is nothing generic to wrap here beyond
 * logging and this one null-to-NotFoundError translation.
 */
export abstract class BaseService {
  protected constructor(
    protected readonly logger: Logger = rootLogger.child({ component: 'service' }),
  ) {}

  /**
   * Translates a repository's `T | null` into either T or a thrown
   * NotFoundError — the existence-validation pattern named explicitly in
   * this subsystem's brief (item 3). Centralized here so every service's
   * getById-style method states its own not-found message without
   * repeating the null-check/throw shape eight times.
   */
  protected assertFound<T>(value: T | null, message: string): T {
    if (value === null) {
      throw new NotFoundError(message);
    }
    return value;
  }
}
