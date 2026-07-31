import type { Logger } from 'pino';
import { createStacRasterClient } from '../../shared/stac';
import type { RasterDatasetClient } from '../types';

/** Sentinel-2 L2A native resolution for the visible/NIR bands most relevant to a heat-exposure use case (EDD Section 13). */
const SENTINEL2_DEFAULT_RESOLUTION_M = 10;

export interface Sentinel2ClientOptions {
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

/**
 * Copernicus Data Space Ecosystem exposes a real STAC API for
 * Sentinel-2 — see shared/stac.ts for the shared parsing/orchestration
 * this wraps. Real credentials aren't available in this environment;
 * see this subsystem's engineering review for how that was verified
 * against a local stand-in instead of overclaiming a real call.
 */
export function createSentinel2Client(options: Sentinel2ClientOptions): RasterDatasetClient {
  return createStacRasterClient({
    sourceCode: 'sentinel2_l2a',
    apiUrl: options.apiUrl,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    collectionName: 'sentinel-2-l2a',
    defaultResolutionM: SENTINEL2_DEFAULT_RESOLUTION_M,
    serviceLabel: 'the Sentinel-2 STAC catalog',
    logger: options.logger,
  });
}
