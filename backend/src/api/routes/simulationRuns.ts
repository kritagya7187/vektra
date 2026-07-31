import { Router } from 'express';
import { z } from 'zod';
import {
  exportSimulationRuns,
  getLatestBaselineSimulationRun,
  getSimulationRunById,
  listSimulationRuns,
} from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { createEnumSchema, paginationSchema, uuidParamSchema } from '../../validators';

const simulationRunExportQuerySchema = z.object({
  format: createEnumSchema(['csv'] as const),
});

export const simulationRunsRouter = Router();

simulationRunsRouter.get(
  '/',
  validateRequest({ query: paginationSchema }),
  asyncHandler(listSimulationRuns),
);

// Must be registered before '/:id' — otherwise Express would match the
// literal path segments "latest-baseline"/"export" as an :id value, and
// uuidParamSchema would reject them with a confusing 400 instead of
// these routes ever being reached.
simulationRunsRouter.get('/latest-baseline', asyncHandler(getLatestBaselineSimulationRun));
simulationRunsRouter.get(
  '/export',
  validateRequest({ query: simulationRunExportQuerySchema }),
  asyncHandler(exportSimulationRuns),
);

simulationRunsRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getSimulationRunById),
);
