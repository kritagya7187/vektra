import { config } from '../config';
import { checkDatabaseHealth } from '../database';
import { rootLogger } from '../logging';
import { bboxSchema } from '../validators';
import { createEsaWorldCoverClient } from './remoteSensing/clients/EsaWorldCoverClient';
import { createLandsatClient } from './remoteSensing/clients/LandsatClient';
import { createSentinel2Client } from './remoteSensing/clients/Sentinel2Client';
import { createSrtmDemClient } from './remoteSensing/clients/SrtmDemClient';
import { createEsaWorldCoverGeeClient } from './remoteSensing/gee/clients/EsaWorldCoverGeeClient';
import { createLandsatGeeClient } from './remoteSensing/gee/clients/LandsatGeeClient';
import { createSentinel2GeeClient } from './remoteSensing/gee/clients/Sentinel2GeeClient';
import { createSrtmDemGeeClient } from './remoteSensing/gee/clients/SrtmDemGeeClient';
import { RasterAssetIngestionService } from './remoteSensing/RasterAssetIngestionService';
import type { RasterDatasetClient, RasterQuery } from './remoteSensing/types';

/**
 * CLI entry point — same role/reasoning as runOsmIngestion.ts (not an
 * HTTP controller; a real scheduler invokes this directly). One process
 * ingests ONE raster source per run, selected via --source=, rather than
 * looping over all 4 internally — keeps each run's failure blast radius
 * and log stream scoped to one source, and matches how a real scheduler
 * would independently schedule "one connector per external source" (EDD
 * Section 10, cited in runOsmIngestion.ts's own header).
 *
 * Usage:
 *   node dist/ingestion/runRasterIngestion.js --source=sentinel2_l2a --bbox=72.80,18.90,72.90,19.00
 *   node dist/ingestion/runRasterIngestion.js --source=landsat_c2_l2 --bbox=... --from=2025-01-01 --to=2025-06-30
 *   node dist/ingestion/runRasterIngestion.js --source=sentinel2_l2a_copernicus --bbox=...  # direct-provider fallback
 *
 * Must be run with POSTGRES_USER/PASSWORD naming a login role granted
 * membership in vektra_ingestion (db/migrations/0014) — same operational
 * requirement as runOsmIngestion.ts.
 */

const logger = rootLogger.child({ component: 'ingestion', entry: 'runRasterIngestion' });

const SOURCE_FLAG = '--source=';
const BBOX_FLAG = '--bbox=';
const FROM_FLAG = '--from=';
const TO_FLAG = '--to=';

interface RasterClientDeps {
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

const RASTER_CLIENT_FACTORIES: Readonly<
  Record<string, (deps: RasterClientDeps) => RasterDatasetClient>
> = {
  // Remote Sensing Strategy Change: Google Earth Engine is now the
  // DEFAULT acquisition mechanism for all 4 sources — each GEE client's
  // real `sourceCode` field is still exactly one of the 4 DB-valid codes
  // (e.g. this srtm_dem key's client reports sourceCode: 'srtm_dem'), so
  // this is a transport swap, not a new database source code. Every GEE
  // client was live-verified against its direct-provider predecessor
  // before being promoted to this default key — see each client file's
  // own doc comment for the real recorded A/B/plausibility result.
  sentinel2_l2a: (deps) => createSentinel2GeeClient(deps),
  landsat_c2_l2: (deps) => createLandsatGeeClient(deps),
  esa_worldcover: (deps) => createEsaWorldCoverGeeClient(deps),
  srtm_dem: (deps) => createSrtmDemGeeClient(deps),
  // Direct-provider clients: dormant fallbacks, not deleted. Each was the
  // default until this migration; kept wired under an explicit key,
  // trivially reachable if GEE ever has an outage or access issue —
  // reinstating the old default is a one-line revert of the 4 lines
  // above, not a code rewrite.
  sentinel2_l2a_copernicus: (deps) => createSentinel2Client(deps),
  landsat_c2_l2_copernicus: (deps) => createLandsatClient(deps),
  esa_worldcover_s3: (deps) => createEsaWorldCoverClient(deps),
  srtm_dem_opentopography: (deps) => createSrtmDemClient(deps),
};

function parseDate(flagValue: string, flagName: string): Date {
  const date = new Date(flagValue);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${flagName}: must be an ISO-8601 date (e.g. 2025-01-01).`);
  }
  return date;
}

function parseArgs(argv: readonly string[]): {
  readonly sourceCode: string;
  readonly query: RasterQuery;
} {
  const sourceArg = argv.find((a) => a.startsWith(SOURCE_FLAG));
  const bboxArg = argv.find((a) => a.startsWith(BBOX_FLAG));
  const fromArg = argv.find((a) => a.startsWith(FROM_FLAG));
  const toArg = argv.find((a) => a.startsWith(TO_FLAG));

  if (!sourceArg) {
    throw new Error(
      `Usage: runRasterIngestion --source=<${Object.keys(RASTER_CLIENT_FACTORIES).join('|')}> --bbox=minLon,minLat,maxLon,maxLat [--from=YYYY-MM-DD --to=YYYY-MM-DD]`,
    );
  }
  const sourceCode = sourceArg.slice(SOURCE_FLAG.length);
  if (!(sourceCode in RASTER_CLIENT_FACTORIES)) {
    throw new Error(
      `Unknown --source '${sourceCode}'. Must be one of: ${Object.keys(RASTER_CLIENT_FACTORIES).join(', ')}.`,
    );
  }

  if (!bboxArg) {
    throw new Error('--bbox is required: minLon,minLat,maxLon,maxLat');
  }
  const bboxResult = bboxSchema.safeParse(bboxArg.slice(BBOX_FLAG.length));
  if (!bboxResult.success) {
    throw new Error(
      `Invalid --bbox: ${bboxResult.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }

  if ((fromArg && !toArg) || (!fromArg && toArg)) {
    throw new Error('--from and --to must be specified together.');
  }
  const dateRange =
    fromArg && toArg
      ? {
          from: parseDate(fromArg.slice(FROM_FLAG.length), '--from'),
          to: parseDate(toArg.slice(TO_FLAG.length), '--to'),
        }
      : undefined;

  return { sourceCode, query: { bbox: bboxResult.data, dateRange } };
}

async function main(): Promise<void> {
  const { sourceCode, query } = parseArgs(process.argv.slice(2));

  logger.info({ nodeEnv: config.nodeEnv, sourceCode, query }, 'raster ingestion run starting');

  const health = await checkDatabaseHealth();
  if (!health.connected || !health.postgis.available) {
    logger.fatal({ health }, 'database unavailable, refusing to start ingestion');
    process.exitCode = 1;
    return;
  }

  const client = RASTER_CLIENT_FACTORIES[sourceCode]({
    timeoutMs: config.remoteSensing.timeoutMs,
    maxRetries: config.remoteSensing.maxRetries,
  });
  const service = new RasterAssetIngestionService(client);
  await service.ingest(query);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'ingestion run failed');
  process.exitCode = 1;
});
