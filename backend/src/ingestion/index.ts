export { OsmIngestionService, osmIngestionService } from './OsmIngestionService';
export type { OsmIngestionServiceDependencies } from './OsmIngestionService';
export { OverpassClient } from './osm/OverpassClient';
export type { OverpassClientOptions } from './osm/OverpassClient';
export { buildBuildingFootprintQuery } from './osm/overpassQueryBuilder';
export {
  parseOverpassResponse,
  parseHeightMeters,
  parseBuildingLevels,
} from './osm/parseOverpassResponse';
export { processGeometry } from './osm/geometry';
export type {
  IngestionArea,
  IngestionCandidate,
  IngestionSummary,
  SkippedFeature,
  ExtractedOsmAttributes,
  GeometryOutcome,
  OsmElement,
  OverpassResponse,
  Ring,
} from './types';

export { fetchWithRetry } from './shared/httpRetry';
export { insertWithSavepointIsolation } from './shared/savepointBatch';

export { RasterAssetIngestionService } from './remoteSensing/RasterAssetIngestionService';
export type { RasterAssetIngestionServiceDependencies } from './remoteSensing/RasterAssetIngestionService';
export { MeteorologicalIngestionService } from './remoteSensing/MeteorologicalIngestionService';
export type { MeteorologicalIngestionServiceDependencies } from './remoteSensing/MeteorologicalIngestionService';
export { createSentinel2Client } from './remoteSensing/clients/Sentinel2Client';
export { createLandsatClient } from './remoteSensing/clients/LandsatClient';
export { createEsaWorldCoverClient } from './remoteSensing/clients/EsaWorldCoverClient';
export { createSrtmDemClient } from './remoteSensing/clients/SrtmDemClient';
export { createOpenMeteoClient } from './remoteSensing/clients/OpenMeteoClient';
export type {
  RasterDatasetClient,
  RasterDatasetMetadata,
  RasterQuery,
  RasterSkippedItem,
  RasterIngestionSummary,
  MeteorologicalObservationClient,
  MeteorologicalQuery,
  MeteorologicalObservationValue,
  MeteorologicalSkippedItem,
  MeteorologicalIngestionSummary,
} from './remoteSensing/types';
