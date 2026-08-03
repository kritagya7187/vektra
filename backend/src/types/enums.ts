/**
 * Every finite value defined by db/migrations or the EDD's closed lists,
 * transcribed from the actual schema (db/schema.sql) and seed data
 * (db/seeds/0001_data_sources.sql), not from memory or invention.
 *
 * Each is const-array-first, type-derived-second
 * (`export const X = [...] as const; export type X = (typeof X)[number]`)
 * rather than a separately hand-maintained type union plus a separately
 * hand-maintained array — the two can't drift apart because there's only
 * one declaration. This also makes every array below a valid argument to
 * validators/primitives.ts's createEnumSchema() (Validation Infrastructure
 * subsystem), so a future endpoint's request validation and this
 * subsystem's domain enums share one source of truth instead of the
 * value list being typed a third time.
 */

/** building.osm_type CHECK constraint (db/migrations/0005). */
export const OSM_TYPES = ['way', 'relation'] as const;
export type OsmType = (typeof OSM_TYPES)[number];

/** simulation_run.run_type CHECK constraint (db/migrations/0008). */
export const RUN_TYPES = ['baseline', 'scenario'] as const;
export type RunType = (typeof RUN_TYPES)[number];

/** simulation_run.status CHECK constraint (db/migrations/0008). */
export const SIMULATION_RUN_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUSES)[number];

/**
 * The closed set of external data sources (EDD Section 13), as currently
 * seeded into data_source (db/seeds/0001_data_sources.sql).
 *
 * Unlike the enums above, this is NOT enforced by a database CHECK
 * constraint on data_source itself — data_source is a lookup table,
 * closed by seed data and Section 13's stated list, not by a hard
 * constraint on the table's own DDL. A future migration could INSERT a
 * 7th source without touching data_source's schema. This type is still
 * accurate and useful (it reflects the actual current closed set,
 * verified against the real seed file), just documented honestly as
 * convention-closed rather than constraint-closed.
 */
export const DATA_SOURCE_CODES = [
  'osm_overpass',
  'srtm_dem',
  'sentinel2_l2a',
  'landsat_c2_l2',
  'esa_worldcover',
  'open_meteo',
] as const;
export type DataSourceCode = (typeof DATA_SOURCE_CODES)[number];

/**
 * environmental_raster_asset.source_code CHECK constraint
 * (db/migrations/0006) — this one IS a real database CHECK constraint,
 * a 4-member subset of DataSourceCode.
 */
export const RASTER_DATA_SOURCE_CODES = [
  'srtm_dem',
  'sentinel2_l2a',
  'landsat_c2_l2',
  'esa_worldcover',
] as const;
export type RasterDataSourceCode = (typeof RASTER_DATA_SOURCE_CODES)[number];

/**
 * meteorological_observation.source_code CHECK constraint
 * (db/migrations/0007, loosened by 0015 to admit 'era5' alongside
 * 'open_meteo' — Remote Sensing Strategy Change: Google Earth Engine
 * acquisition) — also a real database CHECK constraint, constrained to
 * exactly these two values.
 */
export const METEOROLOGICAL_DATA_SOURCE_CODES = ['open_meteo', 'era5'] as const;
export type MeteorologicalDataSourceCode = (typeof METEOROLOGICAL_DATA_SOURCE_CODES)[number];
