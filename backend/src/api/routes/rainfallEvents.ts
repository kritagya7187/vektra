import { Router } from 'express';
import { listRainfallEvents, prepareRainfallEvent } from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { rainfallEventDateParamSchema } from '../../validators';

export const rainfallEventsRouter = Router();

rainfallEventsRouter.get('/', asyncHandler(listRainfallEvents));

rainfallEventsRouter.post(
  '/:eventDate/prepare',
  validateRequest({ params: rainfallEventDateParamSchema }),
  asyncHandler(prepareRainfallEvent),
);
