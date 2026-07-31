import type { Response } from 'express';
import { heatExposureResultService } from '../services';
import type { UuidParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

/**
 * heat_exposure_result / heat_exposure_factor_value (EDD Section 16, 18,
 * 21, 22). Read-only.
 *
 * No pagination here — unlike the other list endpoints,
 * HeatExposureResultService.listForRun() has no {limit, offset} — it
 * returns every result for one run (or the latest baseline run, EDD
 * Section 21's "default: latest baseline run"). runId is the only query
 * input this endpoint actually has a use for.
 */
export interface HeatExposureResultListQuery {
  readonly runId?: string;
}

export async function listHeatExposureResults(
  req: ValidatedRequest<unknown, HeatExposureResultListQuery>,
  res: Response,
): Promise<void> {
  const results = await heatExposureResultService.listForRun(req.query.runId);
  sendData(res, results);
}

export async function getHeatExposureResultById(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const result = await heatExposureResultService.getById(req.params.id);
  sendData(res, result);
}

/**
 * EDD Section 22's inspection panel: the per-factor breakdown for one
 * result. Reuses getWithFactors() (Subsystem 9) rather than a bare
 * factors-only repository call — its existence check (NotFoundError for
 * an unknown result id) is exactly what this sub-route needs too.
 */
export async function getHeatExposureResultFactors(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const { factors } = await heatExposureResultService.getWithFactors(req.params.id);
  sendData(res, factors);
}
