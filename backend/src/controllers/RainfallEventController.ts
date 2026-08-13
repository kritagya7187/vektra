import type { Response } from 'express';
import { getFloodEngineClient } from '../floodEngine';
import type { RainfallEventDateParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

export async function listRainfallEvents(_req: ValidatedRequest, res: Response): Promise<void> {
  const result = await getFloodEngineClient().listRainfallEvents();
  sendData(res, result);
}

export async function prepareRainfallEvent(
  req: ValidatedRequest<RainfallEventDateParam>,
  res: Response,
): Promise<void> {
  const result = await getFloodEngineClient().prepareRainfallEvent(req.params.eventDate);
  sendData(res, result);
}
