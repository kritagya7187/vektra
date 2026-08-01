import * as ee from '@google/earthengine';
import { config } from '../../../config';
import { rootLogger } from '../../../logging';
import { ensureGeeInitialized } from './geeSession';

/**
 * Standalone live-verification CLI (Phase A) — proves ee.initialize()
 * succeeds from THIS codebase's own Node runtime using the real service
 * account, not just the user's separate `earthengine` CLI/Python check.
 * Reads a real band list off USGS/SRTMGL1_003 (the same dataset the
 * user's own out-of-band verification used) to confirm both
 * authentication AND real catalog access work end-to-end.
 *
 * Usage: node dist/ingestion/remoteSensing/gee/verifyGeeAuth.js
 */

const logger = rootLogger.child({ component: 'ingestion', entry: 'verifyGeeAuth' });

async function main(): Promise<void> {
  await ensureGeeInitialized({
    serviceAccountKeyPath: config.googleEarthEngine.serviceAccountKeyPath,
    projectId: config.googleEarthEngine.projectId,
    logger,
  });

  const image = new ee.Image('USGS/SRTMGL1_003');
  const info = await new Promise<unknown>((resolve, reject) => {
    image.getInfo((result: unknown, error?: string) => {
      if (error) {
        reject(new Error(`getInfo() on USGS/SRTMGL1_003 failed: ${error}`));
        return;
      }
      resolve(result);
    });
  });

  const bandNames =
    typeof info === 'object' && info !== null && 'bands' in info
      ? (info as { bands: ReadonlyArray<{ id: string }> }).bands.map((b) => b.id)
      : [];

  logger.info(
    { projectId: config.googleEarthEngine.projectId, dataset: 'USGS/SRTMGL1_003', bandNames },
    'Google Earth Engine live verification succeeded',
  );
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Google Earth Engine live verification failed');
  process.exitCode = 1;
});
