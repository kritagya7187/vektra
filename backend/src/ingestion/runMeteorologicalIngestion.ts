import { config } from '../config';
import { checkDatabaseHealth } from '../database';
import { rootLogger } from '../logging';
import { createOpenMeteoClient } from './remoteSensing/clients/OpenMeteoClient';
import { MeteorologicalIngestionService } from './remoteSensing/MeteorologicalIngestionService';
import type { MeteorologicalQuery } from './remoteSensing/types';

/**
 * CLI entry point — same role/reasoning as runOsmIngestion.ts /
 * runRasterIngestion.ts. Only one meteorological source exists
 * (open_meteo), so there is no --source flag to select.
 *
 * Usage:
 *   node dist/ingestion/runMeteorologicalIngestion.js \
 *     --lat=18.9250 --lon=72.8317 --from=2025-01-01 --to=2025-01-07 \
 *     --variables=temperature_2m,relative_humidity_2m
 *
 * Must be run with POSTGRES_USER/PASSWORD naming a login role granted
 * membership in vektra_ingestion (db/migrations/0014) — same operational
 * requirement as the other two ingestion entry points.
 */

const logger = rootLogger.child({ component: 'ingestion', entry: 'runMeteorologicalIngestion' });

const LAT_FLAG = '--lat=';
const LON_FLAG = '--lon=';
const FROM_FLAG = '--from=';
const TO_FLAG = '--to=';
const VARIABLES_FLAG = '--variables=';

const USAGE =
  'Usage: runMeteorologicalIngestion --lat=<num> --lon=<num> --from=YYYY-MM-DD --to=YYYY-MM-DD --variables=var1,var2';

function requireFlag(argv: readonly string[], flag: string): string {
  const arg = argv.find((a) => a.startsWith(flag));
  if (!arg) {
    throw new Error(`${USAGE}\nMissing required flag: ${flag}`);
  }
  return arg.slice(flag.length);
}

function parseCoordinate(value: string, flagName: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${flagName}: must be a number between ${min} and ${max}.`);
  }
  return parsed;
}

function parseDate(value: string, flagName: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${flagName}: must be an ISO-8601 date (e.g. 2025-01-01).`);
  }
  return date;
}

function parseArgs(argv: readonly string[]): MeteorologicalQuery {
  const latitude = parseCoordinate(requireFlag(argv, LAT_FLAG), '--lat', -90, 90);
  const longitude = parseCoordinate(requireFlag(argv, LON_FLAG), '--lon', -180, 180);
  const from = parseDate(requireFlag(argv, FROM_FLAG), '--from');
  const to = parseDate(requireFlag(argv, TO_FLAG), '--to');
  const variables = requireFlag(argv, VARIABLES_FLAG)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  if (variables.length === 0) {
    throw new Error('--variables must list at least one variable name.');
  }
  if (from >= to) {
    throw new Error('--from must be before --to.');
  }

  return { latitude, longitude, from, to, variables };
}

async function main(): Promise<void> {
  const query = parseArgs(process.argv.slice(2));

  logger.info({ nodeEnv: config.nodeEnv, query }, 'meteorological ingestion run starting');

  const health = await checkDatabaseHealth();
  if (!health.connected || !health.postgis.available) {
    logger.fatal({ health }, 'database unavailable, refusing to start ingestion');
    process.exitCode = 1;
    return;
  }

  const client = createOpenMeteoClient({
    apiUrl: config.remoteSensing.openMeteoApiUrl,
    timeoutMs: config.remoteSensing.timeoutMs,
    maxRetries: config.remoteSensing.maxRetries,
  });
  const service = new MeteorologicalIngestionService(client);
  await service.ingest(query);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'ingestion run failed');
  process.exitCode = 1;
});
