import type { Logger } from 'pino';
import * as ee from '@google/earthengine';
import { fetchWithRetry } from '../../shared/httpRetry';
import { getGeeAuthToken } from './geeSession';
import type { BoundingBox } from '../../../validators';
import type { GeoJsonPolygon } from '../../../types/geometry';
import { ExternalServiceError } from '../../../errors/ExternalServiceError';

/**
 * Shared, mechanical core every GEE-backed RasterDatasetClient uses to
 * turn an already-composed ee.Image (already .select()'ed to the exact
 * band order the caller needs — see factors.ts's hardcoded positional
 * band indices) into real downloaded GeoTIFF bytes. Everything
 * dataset-specific (which collection, date filtering, cloud masking,
 * band reconstruction) lives in the caller — this mirrors the existing
 * "shared plumbing + thin per-source factories" shape already used for
 * copernicusAuth.ts/copernicusDiscovery.ts/copernicusProcessApi.ts.
 *
 * getDownloadURL's real params (confirmed via node_modules/@google/
 * earthengine/src/image.js's own JSDoc, not assumed): format:'GEO_TIFF'
 * (raw file, no zip wrapper) + filePerBand:false (one band-stacked file,
 * required — the real default is one file PER band, which would break
 * every hardcoded positional band index downstream) together produce
 * exactly the single multi-band GeoTIFF rasterSampling.ts/factors.ts
 * expect.
 */

/** Real, documented getDownloadURL grid-dimension limit (per side). */
const MAX_DOWNLOAD_DIMENSION_PX = 10_000;
const APPROX_METERS_PER_DEGREE_LAT = 111_320;

/**
 * Rough pixel-dimension estimate from a bbox + scale, used only for the
 * pre-flight guard below — not a substitute for the real EE-side
 * dimension/byte-size enforcement, which still applies and can still
 * reject a request this estimate underestimates (e.g. very high band
 * counts). Deliberately approximate (equirectangular, not geodesic) since
 * its only job is catching AOIs that are obviously too large before
 * spending a real network round trip, not precise byte accounting.
 */
function estimatePixelDimensions(
  bbox: BoundingBox,
  scaleM: number,
): { readonly widthPx: number; readonly heightPx: number } {
  const midLatRad = (((bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180;
  const metersPerDegreeLon = APPROX_METERS_PER_DEGREE_LAT * Math.cos(midLatRad);
  const widthM = (bbox.maxLon - bbox.minLon) * metersPerDegreeLon;
  const heightM = (bbox.maxLat - bbox.minLat) * APPROX_METERS_PER_DEGREE_LAT;
  return {
    widthPx: Math.ceil(widthM / scaleM),
    heightPx: Math.ceil(heightM / scaleM),
  };
}

export interface FetchGeeImageOptions {
  readonly bbox: BoundingBox;
  readonly region: GeoJsonPolygon;
  readonly scaleM: number;
  readonly crs: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger: Logger;
  /** Used only in log lines and error messages, e.g. "Google Earth Engine (SRTM)". */
  readonly serviceLabel: string;
}

function requestDownloadUrl(image: ee.Image, options: FetchGeeImageOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    image.getDownloadURL(
      {
        region: options.region,
        scale: options.scaleM,
        crs: options.crs,
        format: 'GEO_TIFF',
        filePerBand: false,
      },
      (downloadUrl, error) => {
        if (error || !downloadUrl) {
          reject(
            new ExternalServiceError(
              `${options.serviceLabel}: getDownloadURL() failed: ${error ?? 'no URL returned'}`,
            ),
          );
          return;
        }
        resolve(downloadUrl);
      },
    );
  });
}

export async function fetchGeeImageAsGeoTiff(
  image: ee.Image,
  options: FetchGeeImageOptions,
): Promise<Buffer> {
  const { widthPx, heightPx } = estimatePixelDimensions(options.bbox, options.scaleM);
  if (widthPx > MAX_DOWNLOAD_DIMENSION_PX || heightPx > MAX_DOWNLOAD_DIMENSION_PX) {
    throw new Error(
      `${options.serviceLabel}: requested AOI at ${options.scaleM}m resolution would produce a ` +
        `~${widthPx}x${heightPx}px image, exceeding Earth Engine's synchronous getDownloadURL ` +
        `limit (${MAX_DOWNLOAD_DIMENSION_PX}px per side). The asynchronous ` +
        `Export.image.toCloudStorage path is not yet implemented for VEKTRA — reduce the AOI or ` +
        `resolution.`,
    );
  }

  const downloadUrl = await requestDownloadUrl(image, options);
  // ee.data.getAuthToken() returns the complete Authorization header
  // value (confirmed against the library's own internal usage in
  // node_modules/@google/earthengine/src/apiclient.js: `headers['Authorization']
  // = authToken` with no concatenation anywhere) — it already includes
  // the "Bearer " prefix, so this must NOT prepend another one.
  const authorizationHeader = getGeeAuthToken();

  const response = await fetchWithRetry(
    downloadUrl,
    { headers: { Authorization: authorizationHeader } },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      logger: options.logger,
      serviceLabel: options.serviceLabel,
    },
  );

  return Buffer.from(await response.arrayBuffer());
}
