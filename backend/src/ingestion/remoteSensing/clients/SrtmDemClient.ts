import type { Logger } from 'pino';
import { config } from '../../../config';
import { rootLogger } from '../../../logging';
import { fetchWithRetry } from '../../shared/httpRetry';
import { bboxToPolygon } from '../../shared/bbox';
import { writeRasterFile } from '../rasterStorage';
import type { RasterDatasetClient, RasterDatasetMetadata, RasterQuery } from '../types';

/** SRTM 3 Arc-Second Global native resolution (EDD Section 13: "30 m (SRTM 1 arc-second) or 90 m (3 arc-second)" — this client uses SRTMGL3, confirmed live). */
const SRTM_RESOLUTION_M = 90;
/** SRTM's single acquisition epoch (EDD Section 13: "single epoch (~2000)"). */
const SRTM_ACQUISITION_DATE = new Date('2000-02-01T00:00:00Z');

export interface SrtmDemClientOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

/**
 * OpenTopography's globaldem endpoint, confirmed live: a real request
 * with a real API key returned an actual 6x6px 16-bit elevation GeoTIFF
 * for a test bbox. Unlike the other 3 providers, no separate
 * discovery/extraction split is needed — this one endpoint takes the
 * query bbox directly and returns an already AOI-clipped, already
 * properly-georeferenced GeoTIFF in a single call.
 */
export function createSrtmDemClient(options: SrtmDemClientOptions): RasterDatasetClient {
  const logger =
    options.logger ?? rootLogger.child({ component: 'ingestion', client: 'SrtmDemClient' });

  return {
    sourceCode: 'srtm_dem',
    async fetchMetadata(query: RasterQuery): Promise<readonly RasterDatasetMetadata[]> {
      if (!config.openTopography.apiKey) {
        throw new Error(
          'OPENTOPOGRAPHY_API_KEY must be set to ingest SRTM DEM data (see backend/.env.example).',
        );
      }

      const url = new URL(config.remoteSensing.srtmDemApiUrl);
      url.searchParams.set('demtype', 'SRTMGL3');
      url.searchParams.set('south', String(query.bbox.minLat));
      url.searchParams.set('north', String(query.bbox.maxLat));
      url.searchParams.set('west', String(query.bbox.minLon));
      url.searchParams.set('east', String(query.bbox.maxLon));
      url.searchParams.set('outputFormat', 'GTiff');
      url.searchParams.set('API_Key', config.openTopography.apiKey);

      const response = await fetchWithRetry(
        url.toString(),
        { method: 'GET' },
        {
          timeoutMs: options.timeoutMs,
          maxRetries: options.maxRetries,
          logger,
          serviceLabel: 'the OpenTopography Global DEM API',
        },
      );
      const bytes = Buffer.from(await response.arrayBuffer());

      const sourceProductIdentifier = `SRTMGL3_${query.bbox.minLon}_${query.bbox.minLat}_${query.bbox.maxLon}_${query.bbox.maxLat}`;
      const { storageLocation, checksum } = await writeRasterFile({
        storageDir: config.rasterStorage.dir,
        sourceCode: 'srtm_dem',
        sourceProductIdentifier,
        bytes,
      });

      return [
        {
          sourceProductIdentifier,
          acquisitionDate: SRTM_ACQUISITION_DATE,
          crs: 'EPSG:4326',
          resolutionM: SRTM_RESOLUTION_M,
          storageLocation,
          spatialExtent: bboxToPolygon(query.bbox),
          checksum,
        },
      ];
    },
  };
}
