import type { OsmType } from '../types/enums';
import type { GeoJsonMultiPolygon } from '../types/geometry';

/**
 * building (db/migrations/0005). Building entity (EDD Section 16),
 * Static Geometric Layer (Section 15). One row per versioned OSM
 * footprint snapshot.
 *
 * osmId is `number`, but the `pg` driver returns BIGINT columns as
 * strings by default — the Repository Layer subsystem must configure
 * numeric parsing (or cast in-query) for this to hold true at runtime;
 * see this subsystem's design notes.
 *
 * geomUtm43n and footprintAreaSqm are nullable, matching the schema's
 * actual (not practically-guaranteed) declaration — see design notes.
 */
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
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
