import type { Logger } from 'pino';
import { rootLogger } from '../../logging';
import { fetchWithRetry } from '../shared/httpRetry';
import type { OsmElement, OverpassResponse } from '../types';

export interface OverpassClientOptions {
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

/**
 * Configurable endpoint/timeout/retry (this subsystem's own brief),
 * exponential backoff, HTTP-error-aware, rate-limit-aware — all via the
 * shared fetchWithRetry (ingestion/shared/httpRetry.ts, extracted in the
 * Remote Sensing Ingestion subsystem once a second caller needed the
 * identical logic; this class's own retry/backoff implementation was
 * removed in that refactor, behavior unchanged — see that subsystem's
 * review for the re-verification that confirmed it).
 *
 * Does not touch PostgreSQL — returns parsed OSM elements only. All
 * persistence happens in OsmIngestionService, through the repository
 * layer.
 */
export class OverpassClient {
  private readonly logger: Logger;

  constructor(private readonly options: OverpassClientOptions) {
    this.logger =
      options.logger ?? rootLogger.child({ component: 'ingestion', client: 'overpass' });
  }

  async fetchElements(query: string): Promise<readonly OsmElement[]> {
    this.logger.info({ apiUrl: this.options.apiUrl }, 'downloading OSM data from Overpass API');

    const response = await fetchWithRetry(
      this.options.apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Discovered during real verification against the actual
          // public overpass-api.de: it does real content negotiation
          // and returns 406 Not Acceptable to Node's fetch (undici)
          // default headers — reproduced directly with plain fetch,
          // confirmed fixed by these two headers, before changing
          // anything. Accept: */* satisfies the negotiation; a real
          // User-Agent identifies the client to a public third-party
          // API, which is good practice regardless.
          Accept: '*/*',
          'User-Agent':
            'vektra-backend-osm-ingestion/1.0 (+https://github.com/kritagya7187/vektra)',
        },
        body: new URLSearchParams({ data: query }),
      },
      {
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
        logger: this.logger,
        serviceLabel: 'the Overpass API',
      },
    );

    const parsed = (await response.json()) as OverpassResponse;
    this.logger.info({ elementCount: parsed.elements.length }, 'download complete');
    return parsed.elements;
  }
}
