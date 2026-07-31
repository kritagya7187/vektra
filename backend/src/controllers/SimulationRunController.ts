import type { Response } from 'express';
import { NotFoundError } from '../errors';
import type { CsvColumn } from '../export';
import { fetchAllPages, sendCsv, toCsv } from '../export';
import type { SimulationRun } from '../models';
import { simulationRunService } from '../services';
import type { Pagination, UuidParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

/** simulation_run (EDD Section 16, 17, 21). Read-only — see Subsystem 9's review for why. */

export async function listSimulationRuns(
  req: ValidatedRequest<unknown, Pagination>,
  res: Response,
): Promise<void> {
  const runs = await simulationRunService.list(req.query);
  sendData(res, runs);
}

export async function getSimulationRunById(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const run = await simulationRunService.getById(req.params.id);
  sendData(res, run);
}

/**
 * The service returns null (not a thrown error) because other callers
 * (HeatExposureResultService) need "no baseline run yet" to be
 * non-fatal. This endpoint's entire purpose is fetching that one
 * resource, so translating an absent result to 404 here is
 * response-shaping, not a new business rule.
 */
export async function getLatestBaselineSimulationRun(
  _req: ValidatedRequest,
  res: Response,
): Promise<void> {
  const run = await simulationRunService.getLatestBaselineRun();
  if (run === null) {
    throw new NotFoundError('No completed baseline simulation run is available.');
  }
  sendData(res, run);
}

export interface SimulationRunExportQuery {
  readonly format: 'csv';
}

/** CSV only — explicitly instructed; simulation_run also has no geometry column. */
const SIMULATION_RUN_CSV_COLUMNS: readonly CsvColumn<SimulationRun>[] = [
  { header: 'runId', value: (r) => r.runId },
  { header: 'codeVersion', value: (r) => r.codeVersion },
  { header: 'configurationVersion', value: (r) => r.configurationVersion },
  { header: 'runType', value: (r) => r.runType },
  { header: 'baselineRunId', value: (r) => r.baselineRunId },
  { header: 'status', value: (r) => r.status },
  { header: 'startedAt', value: (r) => r.startedAt },
  { header: 'completedAt', value: (r) => r.completedAt },
  { header: 'errorMessage', value: (r) => r.errorMessage },
  { header: 'createdAt', value: (r) => r.createdAt },
  { header: 'updatedAt', value: (r) => r.updatedAt },
];

/** EDD FR-13 / Section 21. */
export async function exportSimulationRuns(
  req: ValidatedRequest<unknown, SimulationRunExportQuery>,
  res: Response,
): Promise<void> {
  const runs = await fetchAllPages((options) => simulationRunService.list(options));
  const csv = toCsv(runs, SIMULATION_RUN_CSV_COLUMNS);
  req.log.info(
    { resource: 'simulationRun', format: 'csv', rowCount: runs.length },
    'export completed',
  );
  sendCsv(res, 'simulation-runs.csv', csv);
}
