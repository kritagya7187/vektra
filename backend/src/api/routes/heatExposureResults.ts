import { Router } from 'express';
import { z } from 'zod';
import {
  exportHeatExposureResults,
  getHeatExposureResultById,
  getHeatExposureResultFactors,
  listHeatExposureResultFactorsForRun,
  listHeatExposureResults,
} from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import {
  createEnumSchema,
  optionalQueryParam,
  uuidParamSchema,
  uuidSchema,
} from '../../validators';

/**
 * No pagination schema here — see HeatExposureResultController's own
 * note: the underlying service query has no {limit, offset}, only an
 * optional runId (EDD Section 21: "default: latest baseline run" when
 * omitted).
 */
const listHeatExposureResultsQuerySchema = z.object({
  runId: optionalQueryParam(uuidSchema),
});

const heatExposureResultExportQuerySchema = z.object({
  format: createEnumSchema(['csv'] as const),
  runId: optionalQueryParam(uuidSchema),
});

export const heatExposureResultsRouter = Router();

heatExposureResultsRouter.get(
  '/',
  validateRequest({ query: listHeatExposureResultsQuerySchema }),
  asyncHandler(listHeatExposureResults),
);

// Before '/:id' — same route-ordering hazard noted throughout this API.
heatExposureResultsRouter.get(
  '/export',
  validateRequest({ query: heatExposureResultExportQuerySchema }),
  asyncHandler(exportHeatExposureResults),
);

// Also before '/:id', same reason — 'factors' would otherwise be parsed
// as a UUID :id param and 400 rather than reaching this handler.
heatExposureResultsRouter.get(
  '/factors',
  validateRequest({ query: listHeatExposureResultsQuerySchema }),
  asyncHandler(listHeatExposureResultFactorsForRun),
);

heatExposureResultsRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getHeatExposureResultById),
);
heatExposureResultsRouter.get(
  '/:id/factors',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getHeatExposureResultFactors),
);
