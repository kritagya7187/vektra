import { fromFile } from 'geotiff';
import type { GeoJsonMultiPolygon } from '../types/geometry';

/**
 * Phase 3 Milestone 2, Task 4/5 (Raster Processing / Building
 * Attribution). Reads a raster file already downloaded to
 * RASTER_STORAGE_DIR by the ingestion subsystem (rasterStorage.ts) — no
 * network access at simulation time, matching EDD Section 17: "the
 * simulation engine... reads a defined, immutable canonical data
 * snapshot... has no dependency on... any interactive input at run
 * time."
 *
 * Every raster this codebase ingests (Sentinel-2/Landsat via the
 * Process API, SRTM via OpenTopography, WorldCover re-encoded by
 * EsaWorldCoverClient) is requested/produced in EPSG:4326 — the same
 * CRS building.geom_wgs84 is stored in (db/migrations/0005). No
 * coordinate reprojection is needed for zonal sampling as a result;
 * this was verified, not assumed, once every client's actual output CRS
 * was confirmed live (see EsaWorldCoverClient.ts, Sentinel2Client.ts) —
 * an earlier plan to depend on `proj4` for this was dropped once real
 * testing showed it unnecessary for the sources actually implemented.
 *
 * Zonal statistic: the mean of every pixel whose CENTER falls inside the
 * building's footprint (standard point-in-polygon zonal statistics, via
 * the well-known ray-casting algorithm — not an invented method). Falls
 * back to the single pixel covering the footprint's centroid when the
 * footprint is smaller than one pixel and no pixel center falls
 * strictly inside it (common for Sentinel-2's 10m/Landsat's 30m pixels
 * against small building footprints).
 */

export interface ZonalStatsResult {
  readonly mean: number;
  readonly sampleCount: number;
}

/** Ray-casting point-in-polygon test (Jordan curve theorem) — a standard, textbook algorithm, not invented for this project. */
function pointInRing(
  lon: number,
  lat: number,
  ring: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

/** MultiPolygon: a point counts as inside if inside any polygon's outer ring and not inside any of that polygon's holes. */
function pointInMultiPolygon(lon: number, lat: number, multiPolygon: GeoJsonMultiPolygon): boolean {
  return multiPolygon.coordinates.some((polygonRings) => {
    const [outer, ...holes] = polygonRings;
    if (!pointInRing(lon, lat, outer)) {
      return false;
    }
    return !holes.some((hole) => pointInRing(lon, lat, hole));
  });
}

function footprintBounds(multiPolygon: GeoJsonMultiPolygon): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const polygonRings of multiPolygon.coordinates) {
    for (const ring of polygonRings) {
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

function centroid(multiPolygon: GeoJsonMultiPolygon): { lon: number; lat: number } {
  const bounds = footprintBounds(multiPolygon);
  return { lon: (bounds.minLon + bounds.maxLon) / 2, lat: (bounds.minLat + bounds.maxLat) / 2 };
}

/** No-data / masked pixel sentinel used across every evalscript this codebase writes (dataMask band) — samples with dataMask !== 1 are excluded. */
function isValidSample(value: number, dataMaskValue: number | undefined): boolean {
  return Number.isFinite(value) && (dataMaskValue === undefined || dataMaskValue === 1);
}

export async function sampleRasterBandForFootprint(
  storageLocation: string,
  footprint: GeoJsonMultiPolygon,
  bandIndex: number,
  dataMaskBandIndex?: number,
): Promise<ZonalStatsResult | null> {
  const tiff = await fromFile(storageLocation);
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const rasterWidth = image.getWidth();
  const rasterHeight = image.getHeight();
  const pixelWidthDeg = (east - west) / rasterWidth;
  const pixelHeightDeg = (north - south) / rasterHeight;

  const bounds = footprintBounds(footprint);
  const left = Math.max(0, Math.floor((bounds.minLon - west) / pixelWidthDeg));
  const right = Math.min(rasterWidth, Math.ceil((bounds.maxLon - west) / pixelWidthDeg));
  const top = Math.max(0, Math.floor((north - bounds.maxLat) / pixelHeightDeg));
  const bottom = Math.min(rasterHeight, Math.ceil((north - bounds.minLat) / pixelHeightDeg));

  if (left >= right || top >= bottom) {
    return null; // footprint does not intersect this raster at all
  }

  const rasters = await image.readRasters({ window: [left, top, right, bottom] });
  const band = rasters[bandIndex] as unknown as ArrayLike<number>;
  const dataMask =
    dataMaskBandIndex !== undefined
      ? (rasters[dataMaskBandIndex] as unknown as ArrayLike<number>)
      : undefined;
  const windowWidth = right - left;

  const insideValues: number[] = [];
  for (let row = top; row < bottom; row += 1) {
    for (let col = left; col < right; col += 1) {
      const pixelLon = west + (col + 0.5) * pixelWidthDeg;
      const pixelLat = north - (row + 0.5) * pixelHeightDeg;
      if (!pointInMultiPolygon(pixelLon, pixelLat, footprint)) {
        continue;
      }
      const index = (row - top) * windowWidth + (col - left);
      const value = band[index];
      const maskValue = dataMask ? dataMask[index] : undefined;
      if (isValidSample(value, maskValue)) {
        insideValues.push(value);
      }
    }
  }

  if (insideValues.length > 0) {
    const mean = insideValues.reduce((sum, v) => sum + v, 0) / insideValues.length;
    return { mean, sampleCount: insideValues.length };
  }

  // Fallback: footprint smaller than one pixel — use the pixel covering the centroid.
  const c = centroid(footprint);
  const col = Math.min(rasterWidth - 1, Math.max(0, Math.floor((c.lon - west) / pixelWidthDeg)));
  const row = Math.min(rasterHeight - 1, Math.max(0, Math.floor((north - c.lat) / pixelHeightDeg)));
  if (col < left || col >= right || row < top || row >= bottom) {
    return null;
  }
  const index = (row - top) * windowWidth + (col - left);
  const value = band[index];
  const maskValue = dataMask ? dataMask[index] : undefined;
  if (!isValidSample(value, maskValue)) {
    return null;
  }
  return { mean: value, sampleCount: 1 };
}
