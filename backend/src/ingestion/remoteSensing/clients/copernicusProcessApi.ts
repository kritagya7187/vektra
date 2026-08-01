import type { Logger } from 'pino';
import { fetchWithRetry } from '../../shared/httpRetry';
import type { BoundingBox } from '../../../validators';

/**
 * Sentinel Hub Process API (part of Copernicus Data Space Ecosystem) —
 * confirmed live during this milestone's verification: a real POST with
 * type "S2L2A" over a tiny South Mumbai bbox returned a real 50x50px,
 * 3-band GeoTIFF (B04/B08/dataMask). Real Landsat Level-2 type
 * identifier also confirmed ("landsat-ot-l2", resolved by the API's own
 * error message to internal code "LOTL2") — see LandsatClient.ts for
 * that collection's current account-access status.
 *
 * Deliberately fetches RAW BAND VALUES via the evalscript, never a
 * pre-computed index — NDVI/NDBI are computed later, in this
 * repository's own code (domain/spectralIndices.ts), from these raw
 * values. This keeps index computation auditable in our own codebase
 * rather than trusting an opaque server-side calculation, consistent
 * with the Node-native processing architecture decision for this
 * milestone.
 */

export interface ProcessApiRequestOptions {
  readonly processApiUrl: string;
  readonly accessToken: string;
  /** Sentinel Hub collection type identifier, e.g. "S2L2A", "landsat-ot-l2". */
  readonly type: string;
  readonly bbox: BoundingBox;
  readonly timeRange: { readonly from: Date; readonly to: Date };
  readonly evalscript: string;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly maxCloudCoverage?: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger: Logger;
}

export async function fetchProcessApiGeoTiff(options: ProcessApiRequestOptions): Promise<Buffer> {
  const requestBody = {
    input: {
      bounds: {
        bbox: [options.bbox.minLon, options.bbox.minLat, options.bbox.maxLon, options.bbox.maxLat],
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [
        {
          type: options.type,
          dataFilter: {
            timeRange: {
              from: options.timeRange.from.toISOString(),
              to: options.timeRange.to.toISOString(),
            },
            ...(options.maxCloudCoverage !== undefined
              ? { maxCloudCoverage: options.maxCloudCoverage }
              : {}),
          },
        },
      ],
    },
    output: {
      width: options.outputWidth,
      height: options.outputHeight,
      responses: [{ identifier: 'default', format: { type: 'image/tiff' } }],
    },
    evalscript: options.evalscript,
  };

  const response = await fetchWithRetry(
    options.processApiUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      logger: options.logger,
      serviceLabel: 'the Sentinel Hub Process API',
    },
  );

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
