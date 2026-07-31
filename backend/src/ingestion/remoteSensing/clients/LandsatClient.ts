import type { Logger } from 'pino';
import { createStacRasterClient } from '../../shared/stac';
import type { RasterDatasetClient } from '../types';

/** Landsat Collection 2 Level-2 native resolution for surface temperature/reflectance bands (EDD Section 13). */
const LANDSAT_DEFAULT_RESOLUTION_M = 30;

export interface LandsatClientOptions {
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

/**
 * USGS's real LandsatLook service exposes a STAC API — see
 * shared/stac.ts for the shared parsing/orchestration this wraps. Real
 * credentials aren't available in this environment; see this
 * subsystem's engineering review for how that was verified against a
 * local stand-in instead of overclaiming a real call.
 */
export function createLandsatClient(options: LandsatClientOptions): RasterDatasetClient {
  return createStacRasterClient({
    sourceCode: 'landsat_c2_l2',
    apiUrl: options.apiUrl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    collectionName: 'landsat-c2l2-sr',
    defaultResolutionM: LANDSAT_DEFAULT_RESOLUTION_M,
    serviceLabel: 'the Landsat STAC catalog',
    logger: options.logger,
  });
}
