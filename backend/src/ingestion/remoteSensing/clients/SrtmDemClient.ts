import type { Logger } from 'pino';
import { createTileIndexRasterClient } from '../../shared/tileIndex';
import type { RasterDatasetClient } from '../types';

/** SRTM 1 Arc-Second Global native resolution (EDD Section 13). */
const SRTM_DEM_DEFAULT_RESOLUTION_M = 30;

export interface SrtmDemClientOptions {
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

/**
 * SRTM DEM has no single ubiquitous metadata-query API the way
 * Sentinel-2/Landsat's STAC catalogs do — see shared/tileIndex.ts's own
 * note on why this uses a placeholder tile-index shape rather than a
 * claimed real one.
 */
export function createSrtmDemClient(options: SrtmDemClientOptions): RasterDatasetClient {
  return createTileIndexRasterClient({
    sourceCode: 'srtm_dem',
    apiUrl: options.apiUrl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    defaultResolutionM: SRTM_DEM_DEFAULT_RESOLUTION_M,
    serviceLabel: 'the SRTM DEM tile index',
    logger: options.logger,
  });
}
