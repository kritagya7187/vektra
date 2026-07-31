import { config } from '../config';
import { checkDatabaseHealth } from '../database';
import { rootLogger } from '../logging';
import { heatExposureSimulationService } from './HeatExposureSimulationService';
import type { HeatExposureSimulationInput } from './types';

/**
 * CLI entry point — same role/reasoning as the ingestion subsystems'
 * entry points (runOsmIngestion.ts etc.): not an HTTP controller. EDD
 * Section 17 states the simulation engine "has no dependency on the API
 * layer, the frontend, or any interactive input at run time; it is
 * invoked (manually, on a schedule, or by the Scenario Subsystem)" —
 * this is that invocation point.
 *
 * Usage:
 *   node dist/simulation/runHeatExposureSimulation.js
 *   node dist/simulation/runHeatExposureSimulation.js --met-variable=temperature_2m
 *   node dist/simulation/runHeatExposureSimulation.js \
 *     --osm-provenance-id=<uuid> --met-provenance-id=<uuid> --met-variable=temperature_2m
 *
 * Must be run with POSTGRES_USER/PASSWORD naming a login role granted
 * membership in vektra_simulation (db/migrations/0014) — NOT the
 * vektra_backend_api or vektra_ingestion roles other processes use.
 */

const logger = rootLogger.child({ component: 'simulation', entry: 'runHeatExposureSimulation' });

const OSM_PROVENANCE_FLAG = '--osm-provenance-id=';
const MET_PROVENANCE_FLAG = '--met-provenance-id=';
const MET_VARIABLE_FLAG = '--met-variable=';
const CONFIGURATION_VERSION_FLAG = '--configuration-version=';

function parseArgs(argv: readonly string[]): HeatExposureSimulationInput {
  const find = (flag: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(flag));
    return arg ? arg.slice(flag.length) : undefined;
  };

  return {
    osmProvenanceId: find(OSM_PROVENANCE_FLAG),
    meteorologicalProvenanceId: find(MET_PROVENANCE_FLAG),
    meteorologicalVariableName: find(MET_VARIABLE_FLAG),
    configurationVersion: find(CONFIGURATION_VERSION_FLAG),
  };
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));

  logger.info({ nodeEnv: config.nodeEnv, input }, 'heat exposure simulation run starting');

  const health = await checkDatabaseHealth();
  if (!health.connected || !health.postgis.available) {
    logger.fatal({ health }, 'database unavailable, refusing to start simulation');
    process.exitCode = 1;
    return;
  }

  await heatExposureSimulationService.run(input);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'simulation run failed');
  process.exitCode = 1;
});
