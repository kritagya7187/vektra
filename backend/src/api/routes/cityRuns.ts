import { Router } from 'express';
import {
  downloadCityRunArtifact,
  getCityRun,
  getCityRunBoundary,
  listCityRuns,
} from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { cityRunArtifactParamSchema, cityRunIdParamSchema } from '../../validators';

export const cityRunsRouter = Router();

cityRunsRouter.get('/', asyncHandler(listCityRuns));

cityRunsRouter.get(
  '/:runId/download/:artifact',
  validateRequest({ params: cityRunArtifactParamSchema }),
  asyncHandler(downloadCityRunArtifact),
);

cityRunsRouter.get(
  '/:runId/boundary',
  validateRequest({ params: cityRunIdParamSchema }),
  asyncHandler(getCityRunBoundary),
);

cityRunsRouter.get(
  '/:runId',
  validateRequest({ params: cityRunIdParamSchema }),
  asyncHandler(getCityRun),
);
