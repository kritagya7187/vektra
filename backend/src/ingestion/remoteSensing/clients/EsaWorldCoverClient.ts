import type { Logger } from 'pino';
import { createTileIndexRasterClient } from '../../shared/tileIndex';
import type { RasterDatasetClient } from '../types';

/** ESA WorldCover's native product resolution (EDD Section 13). */
const ESA_WORLDCOVER_DEFAULT_RESOLUTION_M = 10;

export interface EsaWorldCoverClientOptions {
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

/**
 * ESA WorldCover has no single ubiquitous metadata-query API the way
 * Sentinel-2/Landsat's STAC catalogs do — see shared/tileIndex.ts's own
 * note on why this uses a placeholder tile-index shape rather than a
 * claimed real one.
 */
export function createEsaWorldCoverClient(
  options: EsaWorldCoverClientOptions,
): RasterDatasetClient {
  return createTileIndexRasterClient({
    sourceCode: 'esa_worldcover',
    apiUrl: options.apiUrl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    defaultResolutionM: ESA_WORLDCOVER_DEFAULT_RESOLUTION_M,
    serviceLabel: 'the ESA WorldCover tile index',
    logger: options.logger,
  });
}
