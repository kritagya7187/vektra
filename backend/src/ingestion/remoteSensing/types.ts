import type { MeteorologicalDataSourceCode, RasterDataSourceCode } from '../../types';
import type { GeoJsonPolygon } from '../../types/geometry';
import type { BoundingBox } from '../../validators';

export interface RasterQuery {
  readonly bbox: BoundingBox;
  readonly dateRange?: { readonly from: Date; readonly to: Date };
}

/** What every raster source's client extracts — metadata only, never raster pixels (this subsystem's own brief, item 6). */
export interface RasterDatasetMetadata {
  readonly sourceProductIdentifier: string;
  readonly acquisitionDate: Date;
  readonly crs: string;
  readonly resolutionM: number;
  readonly storageLocation: string;
  readonly spatialExtent: GeoJsonPolygon;
  readonly checksum: string | null;
}

/**
 * The common interface every one of the 4 raster sources implements —
 * what makes RasterAssetIngestionService a single reusable service
 * rather than 4 near-identical ones.
 */
export interface RasterDatasetClient {
  readonly sourceCode: RasterDataSourceCode;
  fetchMetadata(query: RasterQuery): Promise<readonly RasterDatasetMetadata[]>;
}

export interface RasterSkippedItem {
  readonly sourceProductIdentifier: string;
  readonly reason: string;
}

export interface RasterIngestionSummary {
  readonly sourceCode: RasterDataSourceCode;
  readonly totalDiscovered: number;
  readonly registeredCount: number;
  readonly skippedCount: number;
  readonly skipped: readonly RasterSkippedItem[];
  readonly durationMs: number;
}

export interface MeteorologicalQuery {
  readonly latitude: number;
  readonly longitude: number;
  readonly from: Date;
  readonly to: Date;
  readonly variables: readonly string[];
}

export interface MeteorologicalObservationValue {
  readonly timestamp: Date;
  readonly variableName: string;
  readonly variableValue: number;
  readonly variableUnit: string;
}

/**
 * Mirrors RasterDatasetClient's role (Clients -> Services layering,
 * never SQL) for the one meteorological source. Only one implementation
 * exists (open_meteo is the sole METEOROLOGICAL_DATA_SOURCE_CODES
 * member) — still expressed as an interface, not a concrete class
 * dependency, so MeteorologicalIngestionService can be tested with a
 * stub the same way OsmIngestionService's OverpassClient dependency is.
 */
export interface MeteorologicalObservationClient {
  readonly sourceCode: MeteorologicalDataSourceCode;
  fetchObservations(query: MeteorologicalQuery): Promise<readonly MeteorologicalObservationValue[]>;
}

export interface MeteorologicalSkippedItem {
  readonly timestamp: string;
  readonly variableName: string;
  readonly reason: string;
}

export interface MeteorologicalIngestionSummary {
  readonly provenanceId: string;
  readonly totalObservationsReturned: number;
  readonly insertedCount: number;
  readonly skippedCount: number;
  readonly skipped: readonly MeteorologicalSkippedItem[];
  readonly durationMs: number;
}
