import type { Response } from 'express';
import type { CsvColumn } from '../export';
import { sendCsv, toCsv } from '../export';
import type { HeatExposureResult } from '../models';
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

/**
 * Batch counterpart to getHeatExposureResultFactors — every factor row
 * for every result under one run (default: latest baseline run, same
 * rule as listHeatExposureResults) in a single response, so a frontend
 * driving scene-wide (whole-run) visualization isn't forced into one
 * request per building.
 */
export async function listHeatExposureResultFactorsForRun(
  req: ValidatedRequest<unknown, HeatExposureResultListQuery>,
  res: Response,
): Promise<void> {
  const factors = await heatExposureResultService.listFactorsForRun(req.query.runId);
  sendData(res, factors);
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

export interface HeatExposureResultExportQuery {
  readonly format: 'csv';
  readonly runId?: string;
}

/**
 * CSV only — heat_exposure_result has no geometry column of its own; see
 * this subsystem's review for why a building-geometry-joined GeoJSON
 * view isn't built here.
 */
const HEAT_EXPOSURE_RESULT_CSV_COLUMNS: readonly CsvColumn<HeatExposureResult>[] = [
  { header: 'resultId', value: (r) => r.resultId },
  { header: 'runId', value: (r) => r.runId },
  { header: 'buildingId', value: (r) => r.buildingId },
  { header: 'indexValue', value: (r) => r.indexValue },
  { header: 'computedAt', value: (r) => r.computedAt },
  { header: 'createdAt', value: (r) => r.createdAt },
  { header: 'updatedAt', value: (r) => r.updatedAt },
];

/** EDD FR-13 / Section 21. Same runId-optional, default-to-latest-baseline behavior as listHeatExposureResults. */
export async function exportHeatExposureResults(
  req: ValidatedRequest<unknown, HeatExposureResultExportQuery>,
  res: Response,
): Promise<void> {
  const results = await heatExposureResultService.listForRun(req.query.runId);
  const csv = toCsv(results, HEAT_EXPOSURE_RESULT_CSV_COLUMNS);
  req.log.info(
    { resource: 'heatExposureResult', format: 'csv', rowCount: results.length },
    'export completed',
  );
  sendCsv(res, 'heat-exposure-results.csv', csv);
}
