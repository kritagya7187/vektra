import { Router } from 'express';
import {
  getMeteorologicalObservationById,
  listMeteorologicalObservations,
} from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { paginationSchema, uuidParamSchema } from '../../validators';

export const meteorologicalObservationsRouter = Router();

meteorologicalObservationsRouter.get(
  '/',
  validateRequest({ query: paginationSchema }),
  asyncHandler(listMeteorologicalObservations),
);
meteorologicalObservationsRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getMeteorologicalObservationById),
);
