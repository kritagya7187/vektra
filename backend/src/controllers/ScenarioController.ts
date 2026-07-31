import type { Response } from 'express';
import type { CsvColumn } from '../export';
import { fetchAllPages, sendCsv, toCsv } from '../export';
import type { Scenario } from '../models';
import type { CreateScenarioWithOverridesInput } from '../services';
import { scenarioService } from '../services';
import type { Pagination, UuidParam, ValidatedRequest } from '../validators';
import { sendCreated, sendData } from './respond';

/**
 * scenario / scenario_override (EDD FR-8, FR-9, Section 16, 19, 21). The
 * only write endpoint in this API — every business rule it can violate
 * (empty override set, duplicate override pairs, wrong baseline run
 * type/status, missing building) is enforced by ScenarioService
 * (Subsystem 9), not here. No execution/trigger endpoint — see this
 * subsystem's review for why.
 */

export async function listScenarios(
  req: ValidatedRequest<unknown, Pagination>,
  res: Response,
): Promise<void> {
  const scenarios = await scenarioService.list(req.query);
  sendData(res, scenarios);
}

export async function getScenarioById(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const scenario = await scenarioService.getById(req.params.id);
  sendData(res, scenario);
}

export async function createScenario(
  req: ValidatedRequest<unknown, unknown, CreateScenarioWithOverridesInput>,
  res: Response,
): Promise<void> {
  const created = await scenarioService.createScenario(req.body);
  sendCreated(res, created);
}

export async function getScenarioComparison(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const comparison = await scenarioService.getComparison(req.params.id);
  sendData(res, comparison);
}

export interface ScenarioExportQuery {
  readonly format: 'csv';
}

/**
 * CSV only — scenario has no geometry column of its own; see this
 * subsystem's review for why a building-geometry-joined GeoJSON view
 * (via scenario_override.building_id) isn't built here. This exports
 * the scenario entity itself, not its overrides.
 */
const SCENARIO_CSV_COLUMNS: readonly CsvColumn<Scenario>[] = [
  { header: 'scenarioId', value: (s) => s.scenarioId },
  { header: 'baselineRunId', value: (s) => s.baselineRunId },
  { header: 'derivedRunId', value: (s) => s.derivedRunId },
  { header: 'name', value: (s) => s.name },
  { header: 'description', value: (s) => s.description },
  { header: 'createdBy', value: (s) => s.createdBy },
  { header: 'createdAt', value: (s) => s.createdAt },
  { header: 'updatedAt', value: (s) => s.updatedAt },
];

/** EDD FR-13 / Section 21. */
export async function exportScenarios(
  req: ValidatedRequest<unknown, ScenarioExportQuery>,
  res: Response,
): Promise<void> {
  const scenarios = await fetchAllPages((options) => scenarioService.list(options));
  const csv = toCsv(scenarios, SCENARIO_CSV_COLUMNS);
  req.log.info(
    { resource: 'scenario', format: 'csv', rowCount: scenarios.length },
    'export completed',
  );
  sendCsv(res, 'scenarios.csv', csv);
}
