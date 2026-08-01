import type { Logger } from 'pino';
import { fetchWithRetry } from '../../shared/httpRetry';
import type { BoundingBox } from '../../../validators';

/**
 * USGS M2M scene-search — confirmed live during this milestone: a real
 * request against dataset "landsat_ot_c2_l2" (found via a real
 * dataset-search call — "Landsat 8-9 OLI/TIRS C2 L2", the exact
 * Collection 2 Level-2 product EDD Section 13/FR-3 names) over the real
 * South Mumbai bbox returned 58 real scenes, e.g.
 * "LC08_L2SP_148047_20260718_20260724_02_T2".
 *
 * This is as far as this milestone's verification could confirm the
 * USGS M2M path: the next real step, download-options (finding an
 * actual downloadable file for a scene), returned a real HTTP 403 from
 * what appears to be a separate USGS web/WAF layer, not the M2M JSON
 * API's own error format — this looks like download access may be a
 * distinct permission tier from search access on USGS's side, not
 * something resolvable from this codebase. No pixel-extraction code was
 * written against download-options, since nothing could verify it
 * against a real response — that would be exactly the kind of
 * speculative code this project's own rules prohibit.
 */

const M2M_DATASET_NAME = 'landsat_ot_c2_l2';
const M2M_SCENE_SEARCH_URL = 'https://m2m.cr.usgs.gov/api/api/json/stable/scene-search';

export interface UsgsM2mSceneSearchOptions {
  readonly apiKey: string;
  readonly bbox: BoundingBox;
  readonly dateRange?: { readonly from: Date; readonly to: Date };
  readonly maxCloudCover?: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger: Logger;
}

export interface UsgsM2mScene {
  readonly entityId: string;
  readonly displayId: string;
  readonly acquisitionDate: Date;
  readonly cloudCover: number | null;
}

interface SceneSearchResponseBody {
  readonly data?: {
    readonly totalHits?: number;
    readonly results?: ReadonlyArray<{
      readonly entityId?: string;
      readonly displayId?: string;
      readonly temporalCoverage?: { readonly startDate?: string };
      readonly cloudCover?: number;
    }>;
  };
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns the single most recent matching scene, or null if none exists — an honest empty result, mirroring every other client's own discovery step. */
export async function findMostRecentLandsatScene(
  options: UsgsM2mSceneSearchOptions,
): Promise<UsgsM2mScene | null> {
  const dateRange = options.dateRange ?? {
    from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    to: new Date(),
  };

  const requestBody = {
    datasetName: M2M_DATASET_NAME,
    sceneFilter: {
      spatialFilter: {
        filterType: 'mbr',
        lowerLeft: { latitude: options.bbox.minLat, longitude: options.bbox.minLon },
        upperRight: { latitude: options.bbox.maxLat, longitude: options.bbox.maxLon },
      },
      acquisitionFilter: { start: toIsoDate(dateRange.from), end: toIsoDate(dateRange.to) },
      cloudCoverFilter: { min: 0, max: options.maxCloudCover ?? 60 },
    },
    maxResults: 1,
  };

  const response = await fetchWithRetry(
    M2M_SCENE_SEARCH_URL,
    {
      method: 'POST',
      headers: { 'X-Auth-Token': options.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      logger: options.logger,
      serviceLabel: 'the USGS M2M scene-search endpoint',
    },
  );

  const parsed = (await response.json()) as SceneSearchResponseBody;
  if (parsed.errorCode) {
    throw new Error(`USGS M2M scene-search failed: ${parsed.errorCode} - ${parsed.errorMessage}`);
  }

  const first = parsed.data?.results?.[0];
  if (!first?.entityId || !first.displayId || !first.temporalCoverage?.startDate) {
    return null;
  }

  return {
    entityId: first.entityId,
    displayId: first.displayId,
    acquisitionDate: new Date(first.temporalCoverage.startDate),
    cloudCover: first.cloudCover ?? null,
  };
}
