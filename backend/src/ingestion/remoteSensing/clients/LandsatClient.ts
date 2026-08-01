import type { Logger } from 'pino';
import { config } from '../../../config';
import { rootLogger } from '../../../logging';
import { bboxToPolygon } from '../../shared/bbox';
import { getCopernicusAccessToken } from './copernicusAuth';
import { findMostRecentProduct } from './copernicusDiscovery';
import { fetchProcessApiGeoTiff } from './copernicusProcessApi';
import { writeRasterFile } from '../rasterStorage';
import type { RasterDatasetClient, RasterDatasetMetadata, RasterQuery } from '../types';

/** Landsat Collection 2 Level-2 delivered spatial sampling for the ST band (EDD Section 13: "native TIRS resolution ~100 m, resampled" to 30 m). */
const LANDSAT_RESOLUTION_M = 30;
const SCENE_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;
const ODATA_BASE_URL = 'https://catalogue.dataspace.copernicus.eu/odata/v1/';
/**
 * Sentinel Hub's real Process API type identifier for Landsat Collection
 * 2 Level-2, confirmed live: a request with this type resolved to
 * internal collection code "LOTL2" (the API's own error message) rather
 * than the "Invalid collection type" error every made-up identifier
 * produced. As of this milestone's verification, this account's access
 * to that specific collection was not yet resolved ("Unable to resolve:
 * LOTL2") — likely a separate Landsat data-access terms acceptance on
 * the CDSE dashboard, independent of this file's own OAuth credentials
 * (which are proven to work, since they authenticate real Sentinel-2 and
 * WorldCover calls). This client is implemented against the real,
 * confirmed contract; live end-to-end verification is pending that
 * access resolving (or the separately-registered, separately-pending
 * USGS EROS M2M path as a fallback — not implemented here, since it is
 * a genuinely different API, not a config toggle on this one).
 */
const LANDSAT_PROCESS_API_TYPE = 'landsat-ot-l2';

/**
 * ST_B10 is Landsat Collection 2 Level-2's official Surface Temperature
 * science product band (EDD Section 13, FR-3), already delivered in
 * Kelvin by Sentinel Hub's own processing — not a brightness-temperature
 * value this codebase converts itself. Consuming the already-calibrated
 * official product value, not deriving/inventing one.
 */
const LANDSAT_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: ["ST_B10", "dataMask"],
    output: { bands: 2, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(sample) {
  return [sample.ST_B10, sample.dataMask];
}`;

export interface LandsatClientOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

export function createLandsatClient(options: LandsatClientOptions): RasterDatasetClient {
  const logger =
    options.logger ?? rootLogger.child({ component: 'ingestion', client: 'LandsatClient' });

  return {
    sourceCode: 'landsat_c2_l2',
    async fetchMetadata(query: RasterQuery): Promise<readonly RasterDatasetMetadata[]> {
      const commonDeps = { timeoutMs: options.timeoutMs, maxRetries: options.maxRetries, logger };

      const product = await findMostRecentProduct({
        odataBaseUrl: ODATA_BASE_URL,
        collectionName: 'LANDSAT-8',
        bbox: query.bbox,
        dateRange: query.dateRange,
        ...commonDeps,
      });
      if (!product) {
        return [];
      }

      const accessToken = await getCopernicusAccessToken({
        clientId: config.copernicus.clientId,
        clientSecret: config.copernicus.clientSecret,
        tokenUrl: config.copernicus.tokenUrl,
        ...commonDeps,
      });

      const bytes = await fetchProcessApiGeoTiff({
        processApiUrl: config.remoteSensing.sentinelHubProcessApiUrl,
        accessToken,
        type: LANDSAT_PROCESS_API_TYPE,
        bbox: query.bbox,
        timeRange: {
          from: new Date(product.contentDateStart.getTime() - SCENE_WINDOW_MS),
          to: new Date(product.contentDateStart.getTime() + SCENE_WINDOW_MS),
        },
        evalscript: LANDSAT_EVALSCRIPT,
        outputWidth: 128,
        outputHeight: 128,
        ...commonDeps,
      });

      const { storageLocation, checksum } = await writeRasterFile({
        storageDir: config.rasterStorage.dir,
        sourceCode: 'landsat_c2_l2',
        sourceProductIdentifier: product.name,
        bytes,
      });

      return [
        {
          sourceProductIdentifier: product.name,
          acquisitionDate: product.contentDateStart,
          crs: 'EPSG:4326',
          resolutionM: LANDSAT_RESOLUTION_M,
          storageLocation,
          spatialExtent: bboxToPolygon(query.bbox),
          checksum,
        },
      ];
    },
  };
}
