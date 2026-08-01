import { config } from '../config';
import { checkDatabaseHealth } from '../database';
import { rootLogger } from '../logging';
import { scenarioSimulationService } from './ScenarioSimulationService';
import type { ScenarioSimulationInput } from './types';

/**
 * CLI entry point — same role/reasoning as runHeatExposureSimulation.ts
 * and the ingestion entry points: not an HTTP controller. EDD Section 17
 * ("no dependency on the API layer... invoked manually, on a schedule,
 * or by the Scenario Subsystem") applies equally to scenario execution.
 *
 * Usage:
 *   node dist/simulation/runScenarioSimulation.js --scenario-id=<uuid>
 *   node dist/simulation/runScenarioSimulation.js --scenario-id=<uuid> --met-variable=temperature_2m
 *
 * Must be run with POSTGRES_USER/PASSWORD naming a login role granted
 * membership in vektra_simulation (db/migrations/0014) — the same role
 * runHeatExposureSimulation.ts requires, since this reuses the same
 * repository set plus the scenario/scenario_override tables.
 */

const logger = rootLogger.child({ component: 'simulation', entry: 'runScenarioSimulation' });

const SCENARIO_ID_FLAG = '--scenario-id=';
const MET_VARIABLE_FLAG = '--met-variable=';

function parseArgs(argv: readonly string[]): ScenarioSimulationInput {
  const scenarioIdArg = argv.find((a) => a.startsWith(SCENARIO_ID_FLAG));
  if (!scenarioIdArg) {
    throw new Error('Usage: runScenarioSimulation --scenario-id=<uuid> [--met-variable=<name>]');
  }
  const metVariableArg = argv.find((a) => a.startsWith(MET_VARIABLE_FLAG));

  return {
    scenarioId: scenarioIdArg.slice(SCENARIO_ID_FLAG.length),
    meteorologicalVariableName: metVariableArg?.slice(MET_VARIABLE_FLAG.length),
  };
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));

  logger.info({ nodeEnv: config.nodeEnv, input }, 'scenario simulation run starting');

  const health = await checkDatabaseHealth();
  if (!health.connected || !health.postgis.available) {
    logger.fatal({ health }, 'database unavailable, refusing to start scenario execution');
    process.exitCode = 1;
    return;
  }

  await scenarioSimulationService.run(input);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'scenario execution run failed');
  process.exitCode = 1;
});
