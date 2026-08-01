import type { Logger } from 'pino';
import { config } from '../../../config';
import { rootLogger } from '../../../logging';
import { bboxToPolygon } from '../../shared/bbox';
import { getCopernicusAccessToken } from './copernicusAuth';
import { findMostRecentProduct } from './copernicusDiscovery';
import { fetchProcessApiGeoTiff } from './copernicusProcessApi';
import { writeRasterFile } from '../rasterStorage';
import type { RasterDatasetClient, RasterDatasetMetadata, RasterQuery } from '../types';

/** Sentinel-2 L2A native resolution for the visible/NIR/SWIR bands this evalscript requests (EDD Section 13). */
const SENTINEL2_RESOLUTION_M = 10;
/** A tight window of 15 days around the discovered scene's own acquisition date — narrows the Process API's own internal scene selection to that exact discovered scene, not "whatever's most recent within the full query range." */
const SCENE_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;
const ODATA_BASE_URL = 'https://catalogue.dataspace.copernicus.eu/odata/v1/';

/**
 * Raw B04 (red), B08 (NIR), B11 (SWIR), and the standard L2A Scene
 * Classification (SCL) band — enough to compute NDVI (B04/B08) and NDBI
 * (B08/B11) in this repository's own code (domain/spectralIndices.ts),
 * plus a real, standard quality flag (SCL), never a pre-computed index
 * from Sentinel Hub's side and never an invented band combination.
 */
const SENTINEL2_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "B11", "SCL", "dataMask"],
    output: { bands: 5, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(sample) {
  return [sample.B04, sample.B08, sample.B11, sample.SCL, sample.dataMask];
}`;

export interface Sentinel2ClientOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

export function createSentinel2Client(options: Sentinel2ClientOptions): RasterDatasetClient {
  const logger =
    options.logger ?? rootLogger.child({ component: 'ingestion', client: 'Sentinel2Client' });

  return {
    sourceCode: 'sentinel2_l2a',
    async fetchMetadata(query: RasterQuery): Promise<readonly RasterDatasetMetadata[]> {
      const commonDeps = {
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        logger,
      };

      const product = await findMostRecentProduct({
        odataBaseUrl: ODATA_BASE_URL,
        collectionName: 'SENTINEL-2',
        nameContains: 'MSIL2A',
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
        type: 'S2L2A',
        bbox: query.bbox,
        timeRange: {
          from: new Date(product.contentDateStart.getTime() - SCENE_WINDOW_MS),
          to: new Date(product.contentDateStart.getTime() + SCENE_WINDOW_MS),
        },
        evalscript: SENTINEL2_EVALSCRIPT,
        outputWidth: 512,
        outputHeight: 512,
        maxCloudCoverage: 80,
        ...commonDeps,
      });

      const { storageLocation, checksum } = await writeRasterFile({
        storageDir: config.rasterStorage.dir,
        sourceCode: 'sentinel2_l2a',
        sourceProductIdentifier: product.name,
        bytes,
      });

      return [
        {
          sourceProductIdentifier: product.name,
          acquisitionDate: product.contentDateStart,
          crs: 'EPSG:4326',
          resolutionM: SENTINEL2_RESOLUTION_M,
          storageLocation,
          spatialExtent: bboxToPolygon(query.bbox),
          checksum,
        },
      ];
    },
  };
}
