import type { Response } from 'express';
import { buildingService } from '../services';
import type { Pagination, UuidParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

/** building (EDD Section 15, 16, 21). Read-only, matching the service layer. */

export async function listBuildings(
  req: ValidatedRequest<unknown, Pagination>,
  res: Response,
): Promise<void> {
  const buildings = await buildingService.list(req.query);
  sendData(res, buildings);
}

export async function getBuildingById(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const building = await buildingService.getById(req.params.id);
  sendData(res, building);
}
