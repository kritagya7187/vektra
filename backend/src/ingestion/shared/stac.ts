import type { Logger } from 'pino';
import { rootLogger } from '../../logging';
import type { RasterDataSourceCode } from '../../types';
import type { GeoJsonPolygon } from '../../types/geometry';
import type {
  RasterDatasetClient,
  RasterDatasetMetadata,
  RasterQuery,
} from '../remoteSensing/types';
import { fetchWithRetry } from './httpRetry';

/**
 * Minimal, real STAC (SpatioTemporal Asset Catalog — https://stacspec.org)
 * Item/ItemCollection parsing, shared by Sentinel2Client and
 * LandsatClient: both Copernicus Data Space Ecosystem and USGS
 * LandsatLook genuinely expose STAC APIs in production, so this is
 * grounded in a real, documented standard rather than an invented
 * response shape — even though this environment has no credentials to
 * call either provider's real endpoint. Deliberately minimal: only the
 * fields this schema actually needs (item 2's documented metadata list),
 * not a full STAC implementation.
 */

export interface StacAsset {
  readonly href: string;
  readonly 'checksum:multihash'?: string;
}

export interface StacItem {
  readonly id: string;
  readonly properties: {
    readonly datetime: string;
    readonly 'proj:epsg'?: number;
    readonly gsd?: number;
  };
  readonly geometry?: {
    readonly type: string;
    readonly coordinates: unknown;
  };
  readonly bbox?: readonly [number, number, number, number];
  readonly assets?: Readonly<Record<string, StacAsset>>;
}

export interface StacItemCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly StacItem[];
}

export function bboxToPolygon(bbox: readonly [number, number, number, number]): GeoJsonPolygon {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

function extractExtent(item: StacItem): GeoJsonPolygon | null {
  if (item.geometry && item.geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: item.geometry.coordinates } as GeoJsonPolygon;
  }
  if (item.bbox) {
    return bboxToPolygon(item.bbox);
  }
  return null;
}

function firstAsset(item: StacItem): StacAsset | null {
  if (!item.assets) {
    return null;
  }
  const [, asset] = Object.entries(item.assets)[0] ?? [];
  return asset ?? null;
}

/**
 * Returns one RasterDatasetMetadata per STAC item with usable geometry;
 * items with neither a Polygon geometry nor a bbox are dropped (logged
 * by the caller, matching the same "don't invent geometry" discipline
 * as OSM ingestion's geometry validation).
 */
export function parseStacItemCollection(
  collection: StacItemCollection,
  defaultResolutionM: number,
): readonly (RasterDatasetMetadata | { readonly id: string; readonly reason: string })[] {
  return collection.features.map((item) => {
    const extent = extractExtent(item);
    if (!extent) {
      return { id: item.id, reason: 'STAC item has no usable geometry or bbox' };
    }

    const asset = firstAsset(item);
    if (!asset) {
      return { id: item.id, reason: 'STAC item has no assets (no storage location)' };
    }

    const crs = item.properties['proj:epsg'] ? `EPSG:${item.properties['proj:epsg']}` : 'EPSG:4326';

    const metadata: RasterDatasetMetadata = {
      sourceProductIdentifier: item.id,
      acquisitionDate: new Date(item.properties.datetime),
      crs,
      resolutionM: item.properties.gsd ?? defaultResolutionM,
      storageLocation: asset.href,
      spatialExtent: extent,
      checksum: asset['checksum:multihash'] ?? null,
    };
    return metadata;
  });
}

export function isStacParseFailure(
  value: RasterDatasetMetadata | { readonly id: string; readonly reason: string },
): value is { readonly id: string; readonly reason: string } {
  return 'reason' in value;
}

/**
 * Shared orchestration for both STAC-backed raster sources (Sentinel-2,
 * Landsat) — GET-based STAC Item Search (bbox + collection + optional
 * datetime range), fetched via the shared retry/backoff client, parsed
 * via parseStacItemCollection above. Sentinel2Client.ts and
 * LandsatClient.ts are thin, source-specific configuration wrappers
 * around this — avoiding two near-identical client implementations
 * ("avoid duplicated infrastructure," this subsystem's own principle).
 */
export interface StacClientConfig {
  readonly sourceCode: RasterDataSourceCode;
  readonly apiUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly collectionName: string;
  readonly defaultResolutionM: number;
  readonly serviceLabel: string;
  readonly logger?: Logger;
}

export function createStacRasterClient(config: StacClientConfig): RasterDatasetClient {
  const logger =
    config.logger ?? rootLogger.child({ component: 'ingestion', client: config.sourceCode });

  function buildSearchUrl(query: RasterQuery): string {
    const { minLon, minLat, maxLon, maxLat } = query.bbox;
    const params = new URLSearchParams({
      bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
      collections: config.collectionName,
    });
    if (query.dateRange) {
      params.set(
        'datetime',
        `${query.dateRange.from.toISOString()}/${query.dateRange.to.toISOString()}`,
      );
    }
    return `${config.apiUrl}/search?${params.toString()}`;
  }

  return {
    sourceCode: config.sourceCode,
    async fetchMetadata(query: RasterQuery): Promise<readonly RasterDatasetMetadata[]> {
      const searchUrl = buildSearchUrl(query);
      logger.info({ apiUrl: searchUrl }, `downloading ${config.serviceLabel} metadata`);

      const response = await fetchWithRetry(
        searchUrl,
        { method: 'GET', headers: { Accept: 'application/json' } },
        {
          timeoutMs: config.timeoutMs,
          maxRetries: config.maxRetries,
          logger,
          serviceLabel: config.serviceLabel,
        },
      );

      const collection = (await response.json()) as StacItemCollection;
      const parsed = parseStacItemCollection(collection, config.defaultResolutionM);

      const valid: RasterDatasetMetadata[] = [];
      for (const item of parsed) {
        if (isStacParseFailure(item)) {
          logger.warn(
            { sourceProductIdentifier: item.id, reason: item.reason },
            'skipped STAC item: unusable metadata',
          );
          continue;
        }
        valid.push(item);
      }

      logger.info({ count: valid.length }, `${config.serviceLabel} metadata download complete`);
      return valid;
    },
  };
}
