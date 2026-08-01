import type { Logger } from 'pino';
import * as ee from '@google/earthengine';
import { config } from '../../../../config';
import { rootLogger } from '../../../../logging';
import { bboxToPolygon } from '../../../shared/bbox';
import { writeRasterFile } from '../../rasterStorage';
import { ensureGeeInitialized } from '../geeSession';
import { fetchGeeImageAsGeoTiff } from '../geeImageExport';
import type { RasterDatasetClient, RasterDatasetMetadata, RasterQuery } from '../../types';

/**
 * ESA WorldCover via Google Earth Engine — Phase C, second dataset per
 * the confirmed safest order (also a single static image, no date
 * filter, no cloud mask).
 *
 * Uses ESA/WorldCover/v100 (real EE collection id, one image via
 * `.first()`), band 'Map'. Deliberately kept on the SAME v100/2020 epoch
 * as the existing S3-based EsaWorldCoverClient.ts rather than the newer
 * v200/2021 — switching epochs would be a real scientific-methodology
 * change (which land-cover year buildings get attributed to), explicitly
 * out of scope for an acquisition-layer migration; v200 is logged as a
 * separate future item if ever wanted, not decided here.
 *
 * Real recorded A/B result (bbox 72.830,18.925,72.835,18.930, both
 * ingested live via `docker compose exec backend npm run ingest:raster`
 * against real production endpoints — class codes are the real ESA
 * WorldCover legend: 10=tree cover, 50=built-up, 60=bare/sparse veg.):
 *   GEE (57x56px):  {10: 710 (22.2%), 50: 2358 (73.9%), 60: 124 (3.9%)}
 *   S3  (61x60px):  {10: 816 (22.3%), 50: 2710 (74.0%), 60: 134 (3.7%)}
 * Class proportions agree within ~1 percentage point; the small pixel-
 * count difference is grid/window-boundary alignment (GEE's own region
 * clipping vs. this codebase's manual tile-window math in
 * EsaWorldCoverClient.ts), not a data discrepancy. Verified via
 * geotiff.js read-back of both real written files.
 */

const WORLDCOVER_GEE_COLLECTION_ID = 'ESA/WorldCover/v100';
const WORLDCOVER_GEE_BAND = 'Map';
const WORLDCOVER_GEE_RESOLUTION_M = 10;
const WORLDCOVER_GEE_ACQUISITION_DATE = new Date('2020-01-01T00:00:00Z');

export interface EsaWorldCoverGeeClientOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

export function createEsaWorldCoverGeeClient(
  options: EsaWorldCoverGeeClientOptions,
): RasterDatasetClient {
  const logger =
    options.logger ??
    rootLogger.child({ component: 'ingestion', client: 'EsaWorldCoverGeeClient' });

  return {
    sourceCode: 'esa_worldcover',
    async fetchMetadata(query: RasterQuery): Promise<readonly RasterDatasetMetadata[]> {
      await ensureGeeInitialized({
        serviceAccountKeyPath: config.googleEarthEngine.serviceAccountKeyPath,
        projectId: config.googleEarthEngine.projectId,
        logger,
      });

      const region = bboxToPolygon(query.bbox);
      const clipGeometry = ee.Geometry.Rectangle([
        query.bbox.minLon,
        query.bbox.minLat,
        query.bbox.maxLon,
        query.bbox.maxLat,
      ]);
      const image = new ee.ImageCollection(WORLDCOVER_GEE_COLLECTION_ID)
        .first()
        .select([WORLDCOVER_GEE_BAND])
        .clip(clipGeometry);

      const bytes = await fetchGeeImageAsGeoTiff(image, {
        bbox: query.bbox,
        region,
        scaleM: WORLDCOVER_GEE_RESOLUTION_M,
        crs: 'EPSG:4326',
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        logger,
        serviceLabel: 'Google Earth Engine (ESA WorldCover v100)',
      });

      const sourceProductIdentifier = `ESA_WorldCover_v100_2020_${query.bbox.minLon}_${query.bbox.minLat}_${query.bbox.maxLon}_${query.bbox.maxLat}`;
      const { storageLocation, checksum } = await writeRasterFile({
        storageDir: config.rasterStorage.dir,
        sourceCode: 'esa_worldcover',
        sourceProductIdentifier,
        bytes,
      });

      return [
        {
          sourceProductIdentifier,
          acquisitionDate: WORLDCOVER_GEE_ACQUISITION_DATE,
          crs: 'EPSG:4326',
          resolutionM: WORLDCOVER_GEE_RESOLUTION_M,
          storageLocation,
          spatialExtent: region,
          checksum,
        },
      ];
    },
  };
}
