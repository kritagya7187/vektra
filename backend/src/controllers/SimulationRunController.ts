import type { Response } from 'express';
import { NotFoundError } from '../errors';
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
