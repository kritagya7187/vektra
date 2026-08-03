import type { GeoJsonMultiPolygon, GeoJsonPoint, GeoJsonPolygon } from './geometry';

/**
 * DTO shapes mirroring backend/src/models/*.ts and backend/src/types/
 * enums.ts exactly (field names, nullability, closed value sets) —
 * these describe what actually arrives over the wire, not an aspiration.
 * Timestamp fields are `string` (ISO 8601), not `Date`: JSON has no date
 * type, and Express's res.json() serializes every Date via its own
 * toJSON() into an ISO string — parsing to a real Date happens only at
 * the point of display (src/utils/formatting.ts), not in these DTOs.
 */

export type OsmType = 'way' | 'relation';
export type RunType = 'baseline' | 'scenario';
export type SimulationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DataSource {
  readonly sourceCode: string;
  readonly displayName: string;
  readonly license: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DataProvenanceRecord {
  readonly provenanceId: string;
  readonly sourceCode: string;
  readonly sourceProductIdentifier: string;
  readonly retrievalTimestamp: string;
  readonly license: string;
  readonly ingestionPipelineVersion: string;
  readonly checksum: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Building {
  readonly buildingId: string;
  readonly osmId: number;
  readonly osmType: OsmType;
  readonly buildingTagType: string | null;
  readonly name: string | null;
  readonly heightM: number | null;
  readonly buildingLevels: number | null;
  readonly geomWgs84: GeoJsonMultiPolygon;
  readonly geomUtm43n: GeoJsonMultiPolygon | null;
  readonly footprintAreaSqm: number | null;
  readonly provenanceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The properties payload of a /buildings/export?format=geojson Feature — Building minus its two geometry fields (they become the Feature's own geometry). */
export type BuildingGeoJsonProperties = Omit<Building, 'geomWgs84' | 'geomUtm43n'>;

export interface SimulationRun {
  readonly runId: string;
  readonly codeVersion: string;
  readonly configurationVersion: string;
  readonly runType: RunType;
  readonly baselineRunId: string | null;
  readonly status: SimulationRunStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnvironmentalRasterAsset {
  readonly rasterAssetId: string;
  readonly sourceCode: string;
  readonly acquisitionDate: string;
  readonly crs: string;
  readonly resolutionM: number;
  readonly storageLocation: string;
  readonly spatialExtent: GeoJsonPolygon;
  readonly provenanceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MeteorologicalObservation {
  readonly metObservationId: string;
  readonly sourceCode: string;
  readonly observationTimestamp: string;
  readonly location: GeoJsonPoint;
  readonly variableName: string;
  readonly variableValue: number;
  readonly variableUnit: string;
  readonly provenanceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
