import type { Response } from 'express';
import { meteorologicalObservationService } from '../services';
import type { Pagination, UuidParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

/** meteorological_observation (EDD Section 15, 16, 21). Read-only. */

export async function listMeteorologicalObservations(
  req: ValidatedRequest<unknown, Pagination>,
  res: Response,
): Promise<void> {
  const observations = await meteorologicalObservationService.list(req.query);
  sendData(res, observations);
}

export async function getMeteorologicalObservationById(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const observation = await meteorologicalObservationService.getById(req.params.id);
  sendData(res, observation);
}
