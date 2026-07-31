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
