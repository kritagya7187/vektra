import type { Database } from '../database';
import type { Building } from '../models';
import type { HeatExposureFactorValueRepository, HeatExposureResultRepository } from '../types';
import { FACTOR_KEYS } from '../types';
import { computeFactor, type MeteorologicalReading } from './factors';

/**
 * Extracted from HeatExposureSimulationService's own private
 * computeAndPersistBuildingResult once ScenarioSimulationService needed
 * the identical per-building "create a HeatExposureResult + its 5
 * HeatExposureFactorValue rows" logic — "Do not duplicate persistence
 * logic" (Scenario Simulation Engine subsystem's own explicit
 * instruction). Not a bug fix: HeatExposureSimulationService's own
 * behavior is unchanged by this extraction, only reorganized, mirroring
 * the same reuse-driven extraction already done for
 * ingestion/shared/httpRetry.ts and ingestion/shared/savepointBatch.ts.
 * HeatExposureSimulationService's full test suite was re-run afterward
 * to confirm zero behavioral regression.
 *
 * Deliberately takes the repository instances as parameters rather than
 * importing default singletons — both callers already depend on
 * constructor-injected repositories for testability, and this function
 * must respect whichever instances a caller was given (e.g. a test's
 * fake repository).
 */
export interface PersistHeatExposureResultsDeps {
  readonly heatExposureResultRepository: HeatExposureResultRepository;
  readonly heatExposureFactorValueRepository: HeatExposureFactorValueRepository;
}

export async function persistHeatExposureResults(
  tx: Database,
  runId: string,
  buildings: readonly Building[],
  meteorologicalReading: MeteorologicalReading | null,
  deps: PersistHeatExposureResultsDeps,
): Promise<number> {
  for (const building of buildings) {
    const result = await deps.heatExposureResultRepository.create(
      { runId, buildingId: building.buildingId },
      tx,
    );

    for (const factorKey of FACTOR_KEYS) {
      const computation = computeFactor(factorKey, meteorologicalReading);
      await deps.heatExposureFactorValueRepository.create(
        {
          resultId: result.resultId,
          factorKey,
          factorValue: computation.factorValue,
          isComputable: computation.isComputable,
          notes: computation.notes,
        },
        tx,
      );
    }
  }

  return buildings.length;
}
