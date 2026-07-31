import { config } from '../config';
import { checkDatabaseHealth } from '../database';
import { rootLogger } from '../logging';
import { bboxSchema } from '../validators';
import { osmIngestionService } from './OsmIngestionService';
import type { IngestionArea } from './types';

/**
 * CLI entry point — not an HTTP controller. EDD Section 10 describes
 * ingestion as "one connector per external source... independently
 * schedulable," not a request-triggered API operation, and this
 * subsystem's own brief explicitly excludes a background job scheduler
 * and lists no HTTP endpoint anywhere in its Scope section. This plays
 * the structurally equivalent role a controller would (parse input,
 * call the service, shape output, no business logic of its own) — a
 * real scheduler (cron, CI job, manual run) invokes this directly.
 *
 * Usage:
 *   node dist/ingestion/runOsmIngestion.js --bbox=72.80,18.90,72.90,19.00
 *   node dist/ingestion/runOsmIngestion.js --area="South Mumbai"
 *
 * Must be run with POSTGRES_USER/PASSWORD naming a login role granted
 * membership in vektra_ingestion (db/migrations/0014) — NOT the
 * vektra_backend_api-derived role the API server uses. Same config
 * schema, same env var names, different required role membership
 * depending on which process is launched — an operational/deployment
 * concern, not a second config mechanism.
 */

const logger = rootLogger.child({ component: 'ingestion', entry: 'runOsmIngestion' });

const BBOX_FLAG = '--bbox=';
const AREA_FLAG = '--area=';

function parseArgs(argv: readonly string[]): IngestionArea {
  const bboxArg = argv.find((a) => a.startsWith(BBOX_FLAG));
  const areaArg = argv.find((a) => a.startsWith(AREA_FLAG));

  if (bboxArg && areaArg) {
    throw new Error('Specify either --bbox or --area, not both.');
  }

  if (bboxArg) {
    // Reuses the EXISTING bbox validator (validators/boundingBox.ts) —
    // the same structural/geographic validity checks the HTTP layer
    // uses, not a second, duplicated implementation.
    const result = bboxSchema.safeParse(bboxArg.slice(BBOX_FLAG.length));
    if (!result.success) {
      throw new Error(
        `Invalid --bbox: ${result.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    return { kind: 'bbox', bbox: result.data };
  }

  if (areaArg) {
    const areaName = areaArg.slice(AREA_FLAG.length).trim();
    if (areaName.length === 0) {
      throw new Error('--area must not be empty.');
    }
    return { kind: 'namedArea', areaName };
  }

  throw new Error(
    'Usage: runOsmIngestion --bbox=minLon,minLat,maxLon,maxLat OR --area="Area Name"',
  );
}

async function main(): Promise<void> {
  const area = parseArgs(process.argv.slice(2));

  logger.info({ nodeEnv: config.nodeEnv, area }, 'OSM ingestion run starting');

  // Same "fail clearly if the database is unavailable" check
  // src/server.ts performs before serving traffic (Server Bootstrap
  // subsystem) — reused here, not reimplemented, for the same reason:
  // there is nothing safe to do if PostGIS isn't reachable.
  const health = await checkDatabaseHealth();
  if (!health.connected || !health.postgis.available) {
    logger.fatal({ health }, 'database unavailable, refusing to start ingestion');
    process.exitCode = 1;
    return;
  }

  await osmIngestionService.ingest(area);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'ingestion run failed');
  process.exitCode = 1;
});
