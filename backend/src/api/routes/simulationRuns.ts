import { Router } from 'express';
import {
  getLatestBaselineSimulationRun,
  getSimulationRunById,
  listSimulationRuns,
} from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { paginationSchema, uuidParamSchema } from '../../validators';

export const simulationRunsRouter = Router();

simulationRunsRouter.get(
  '/',
  validateRequest({ query: paginationSchema }),
  asyncHandler(listSimulationRuns),
);

// Must be registered before '/:id' — otherwise Express would match the
// literal path segment "latest-baseline" as an :id value, and
// uuidParamSchema would reject it with a confusing 400 instead of this
// route ever being reached.
simulationRunsRouter.get('/latest-baseline', asyncHandler(getLatestBaselineSimulationRun));

simulationRunsRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getSimulationRunById),
);
