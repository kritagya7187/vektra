import type { Logger } from 'pino';
import { rootLogger } from '../../logging';
import type { RasterDataSourceCode } from '../../types';
import type {
  RasterDatasetClient,
  RasterDatasetMetadata,
  RasterQuery,
} from '../remoteSensing/types';
import { fetchWithRetry } from './httpRetry';
import { bboxToPolygon } from './stac';

/**
 * Shared orchestration for the two fixed-tile-grid raster sources (ESA
 * WorldCover, SRTM DEM) — neither has a single ubiquitous STAC-style
 * metadata-query API the way Sentinel-2/Landsat do (or at least none
 * this environment could confirm without real credentials/deeper
 * provider-specific research). This JSON shape is a reasonable,
 * self-describing placeholder — a simple tile list with an explicit
 * bbox per tile — NOT a claimed real standard the way STAC is.
 * EsaWorldCoverClient.ts / SrtmDemClient.ts are thin wrappers around
 * this, exactly mirroring how Sentinel2Client/LandsatClient wrap
 * createStacRasterClient — swapping this placeholder shape for each
 * provider's actual real response format is the one thing that would
 * need to change to point at a real provider later.
 */

export interface TileIndexEntry {
  readonly tileId: string;
  readonly acquisitionDate: string;
  readonly crs: string;
  readonly resolutionM?: number;
  readonly downloadUrl: string;
  readonly checksum?: string;
  readonly bbox: readonly [number, number, number, number];
}

export interface TileIndexResponse {
  readonly tiles: readonly TileIndexEntry[];
}

export interface TileIndexClientConfig {
  readonly sourceCode: RasterDataSourceCode;
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly defaultResolutionM: number;
  readonly serviceLabel: string;
  readonly logger?: Logger;
}

export function createTileIndexRasterClient(config: TileIndexClientConfig): RasterDatasetClient {
  const logger =
    config.logger ?? rootLogger.child({ component: 'ingestion', client: config.sourceCode });

  function buildQueryUrl(query: RasterQuery): string {
    const { minLon, minLat, maxLon, maxLat } = query.bbox;
    const params = new URLSearchParams({ bbox: `${minLon},${minLat},${maxLon},${maxLat}` });
    return `${config.apiUrl}?${params.toString()}`;
  }

  return {
    sourceCode: config.sourceCode,
    async fetchMetadata(query: RasterQuery): Promise<readonly RasterDatasetMetadata[]> {
      const requestUrl = buildQueryUrl(query);
      logger.info({ apiUrl: requestUrl }, `downloading ${config.serviceLabel} metadata`);

      const response = await fetchWithRetry(
        requestUrl,
        { method: 'GET', headers: { Accept: 'application/json' } },
        {
          timeoutMs: config.timeoutMs,
          maxRetries: config.maxRetries,
          logger,
          serviceLabel: config.serviceLabel,
        },
      );

      const body = (await response.json()) as TileIndexResponse;
      const results: RasterDatasetMetadata[] = [];

      for (const tile of body.tiles) {
        if (!tile.bbox || tile.bbox.length !== 4) {
          logger.warn({ tileId: tile.tileId }, 'skipped tile: missing or malformed bbox');
          continue;
        }
        results.push({
          sourceProductIdentifier: tile.tileId,
          acquisitionDate: new Date(tile.acquisitionDate),
          crs: tile.crs,
          resolutionM: tile.resolutionM ?? config.defaultResolutionM,
          storageLocation: tile.downloadUrl,
          spatialExtent: bboxToPolygon(tile.bbox),
          checksum: tile.checksum ?? null,
        });
      }

      logger.info({ count: results.length }, `${config.serviceLabel} metadata download complete`);
      return results;
    },
  };
}
