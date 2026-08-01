import { fromUrl, writeArrayBuffer } from 'geotiff';
import type { Logger } from 'pino';
import { config } from '../../../config';
import { rootLogger } from '../../../logging';
import { bboxToPolygon } from '../../shared/bbox';
import { writeRasterFile } from '../rasterStorage';
import type { RasterDatasetClient, RasterDatasetMetadata, RasterQuery } from '../types';

/** ESA WorldCover native resolution (EDD Section 13). */
const WORLDCOVER_RESOLUTION_M = 10;
/** The only real, released v100 acquisition epoch (EDD Section 13: "two static epochs only — 2020 (v100) and 2021 (v200)") — this client uses v100/2020, the tile grid confirmed live against the real public bucket. */
const WORLDCOVER_ACQUISITION_DATE = new Date('2020-01-01T00:00:00Z');
const TILE_GRID_DEGREES = 3;

/**
 * ESA WorldCover is NOT behind Copernicus auth — confirmed live: a real
 * unauthenticated byte-range GET against the public AWS S3 bucket
 * (s3://esa-worldcover, region eu-central-1) returned a valid TIFF
 * header with Accept-Ranges: bytes. This client reads a small AOI
 * window from the real 146MB global tile via geotiff.js's own windowed
 * `readRasters` (which issues HTTP range requests, never downloading
 * the full tile) and re-encodes that small window as a standalone,
 * correctly-georeferenced GeoTIFF for local storage — the other 3
 * providers already return an AOI-sized GeoTIFF directly from their own
 * API; this is the one source where that windowing has to happen on our
 * side, since S3 only exposes whole tiles.
 */
function tileFileName(lat: number, lon: number): string {
  const tileLat = Math.floor(lat / TILE_GRID_DEGREES) * TILE_GRID_DEGREES;
  const tileLon = Math.floor(lon / TILE_GRID_DEGREES) * TILE_GRID_DEGREES;
  const latLabel = `${tileLat >= 0 ? 'N' : 'S'}${String(Math.abs(tileLat)).padStart(2, '0')}`;
  const lonLabel = `${tileLon >= 0 ? 'E' : 'W'}${String(Math.abs(tileLon)).padStart(3, '0')}`;
  return `ESA_WorldCover_10m_2020_v100_${latLabel}${lonLabel}_Map.tif`;
}

export interface EsaWorldCoverClientOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger?: Logger;
}

export function createEsaWorldCoverClient(
  options: EsaWorldCoverClientOptions,
): RasterDatasetClient {
  const logger =
    options.logger ?? rootLogger.child({ component: 'ingestion', client: 'EsaWorldCoverClient' });

  return {
    sourceCode: 'esa_worldcover',
    async fetchMetadata(query: RasterQuery): Promise<readonly RasterDatasetMetadata[]> {
      const { minLon, minLat, maxLon, maxLat } = query.bbox;
      const centerLat = (minLat + maxLat) / 2;
      const centerLon = (minLon + maxLon) / 2;
      const fileName = tileFileName(centerLat, centerLon);
      const tileUrl = `${config.remoteSensing.esaWorldCoverS3BaseUrl}/v100/2020/map/${fileName}`;

      logger.info({ tileUrl, bbox: query.bbox }, 'reading ESA WorldCover tile window');

      const tiff = await fromUrl(tileUrl);
      const image = await tiff.getImage();
      const tileBbox = image.getBoundingBox(); // [west, south, east, north] in the tile's own CRS (EPSG:4326)
      const [tileWest, , , tileNorth] = tileBbox;
      const [pixelWidthDeg, pixelHeightDeg] = image.getResolution();
      const rasterWidth = image.getWidth();
      const rasterHeight = image.getHeight();

      // Convert the query bbox (geographic) to a pixel window within this
      // tile — standard raster-space <-> geographic-space conversion
      // using the tile's own real, embedded resolution/origin, not an
      // assumed one.
      const left = Math.max(0, Math.floor((minLon - tileWest) / Math.abs(pixelWidthDeg)));
      const right = Math.min(rasterWidth, Math.ceil((maxLon - tileWest) / Math.abs(pixelWidthDeg)));
      const top = Math.max(0, Math.floor((tileNorth - maxLat) / Math.abs(pixelHeightDeg)));
      const bottom = Math.min(
        rasterHeight,
        Math.ceil((tileNorth - minLat) / Math.abs(pixelHeightDeg)),
      );

      if (left >= right || top >= bottom) {
        logger.warn(
          { query: query.bbox, tileBbox },
          'query bbox does not intersect the resolved WorldCover tile',
        );
        return [];
      }

      const [windowData] = await image.readRasters({ window: [left, top, right, bottom] });
      const windowWidth = right - left;
      const windowHeight = bottom - top;

      const windowOriginLon = tileWest + left * Math.abs(pixelWidthDeg);
      const windowOriginLat = tileNorth - top * Math.abs(pixelHeightDeg);

      const outputBuffer = writeArrayBuffer(windowData as Uint8Array, {
        width: windowWidth,
        height: windowHeight,
        SamplesPerPixel: 1,
        BitsPerSample: [8],
        PhotometricInterpretation: 1, // BlackIsZero — matches the source Map layer's own class-value encoding
        ModelPixelScale: [Math.abs(pixelWidthDeg), Math.abs(pixelHeightDeg), 0],
        ModelTiepoint: [0, 0, 0, windowOriginLon, windowOriginLat, 0],
        // Real, verified fix: geotiff.js's writer (geotiffwriter.js) only
        // respects a caller-supplied ModelTiepoint when
        // `GeographicTypeGeoKey` is present as a TOP-LEVEL metadata
        // field — passing a hand-built GeoKeyDirectory array instead (the
        // first attempt here) does not satisfy that check, so the writer
        // silently falls through to its own "raster fits whole globe"
        // default (ModelTiepoint [0,0,0,-180,90,0]), discovered by
        // round-trip-reading the very first real output file and finding
        // its bounding box was [-180, 89.995, ...] instead of South
        // Mumbai. These three plain GeoKey fields are the writer's own
        // documented, higher-level input; it assembles the actual
        // GeoKeyDirectory tag from them itself.
        GTModelTypeGeoKey: 2, // Geographic
        GTRasterTypeGeoKey: 1, // PixelIsArea
        GeographicTypeGeoKey: 4326, // WGS84
      });

      const sourceProductIdentifier = fileName.replace('.tif', '');
      const { storageLocation, checksum } = await writeRasterFile({
        storageDir: config.rasterStorage.dir,
        sourceCode: 'esa_worldcover',
        sourceProductIdentifier,
        bytes: Buffer.from(outputBuffer),
      });

      return [
        {
          sourceProductIdentifier,
          acquisitionDate: WORLDCOVER_ACQUISITION_DATE,
          crs: 'EPSG:4326',
          resolutionM: WORLDCOVER_RESOLUTION_M,
          storageLocation,
          spatialExtent: bboxToPolygon(query.bbox),
          checksum,
        },
      ];
    },
  };
}
