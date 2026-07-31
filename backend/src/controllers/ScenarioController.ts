import type { Response } from 'express';
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
