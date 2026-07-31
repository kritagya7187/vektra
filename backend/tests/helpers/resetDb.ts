import { afterAll, beforeEach } from 'vitest';
import { superuserPool } from './superuserPool';

/**
 * Every mutable table, truncated before EVERY test (not just every
 * file) — the simplest way to guarantee every test starts from an
 * identical, deterministic, seed-only state. data_source is
 * deliberately excluded: it's reference/lookup data, seeded once by
 * db/seeds/0001_data_sources.sql, never mutated by the application
 * (db/migrations/0014 grants the backend role no write access to it
 * either) — truncating and re-seeding it every test would be pure
 * overhead for a table nothing ever changes.
 */
const MUTABLE_TABLES = [
  'heat_exposure_factor_value',
  'heat_exposure_result',
  'scenario_override',
  'scenario',
  'simulation_run_input_dataset',
  'simulation_run',
  'meteorological_observation',
  'environmental_raster_asset',
  'building',
  'data_provenance_record',
];

beforeEach(async () => {
  await superuserPool.query(`TRUNCATE ${MUTABLE_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await superuserPool.end();
});
