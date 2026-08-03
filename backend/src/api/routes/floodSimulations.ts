import { Router } from 'express';
import {
  cancelFloodSimulation,
  downloadFloodSimulationArtifact,
  getFloodSimulationStatus,
  getFloodSimulationSummary,
  submitFloodSimulation,
} from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import {
  floodSimulationArtifactParamSchema,
  floodSimulationRunIdParamSchema,
  submitFloodSimulationBodySchema,
} from '../../validators';

export const floodSimulationsRouter = Router();

floodSimulationsRouter.post(
  '/',
  validateRequest({ body: submitFloodSimulationBodySchema }),
  asyncHandler(submitFloodSimulation),
);

floodSimulationsRouter.get(
  '/:runId',
  validateRequest({ params: floodSimulationRunIdParamSchema }),
  asyncHandler(getFloodSimulationStatus),
);

floodSimulationsRouter.get(
  '/:runId/summary',
  validateRequest({ params: floodSimulationRunIdParamSchema }),
  asyncHandler(getFloodSimulationSummary),
);

// Must be registered before any catch-all -- there is none on this
// router today, but matches the ordering discipline simulationRuns.ts's
// own router already documents for its literal-segment routes.
floodSimulationsRouter.get(
  '/:runId/download/:artifact',
  validateRequest({ params: floodSimulationArtifactParamSchema }),
  asyncHandler(downloadFloodSimulationArtifact),
);

floodSimulationsRouter.post(
  '/:runId/cancel',
  validateRequest({ params: floodSimulationRunIdParamSchema }),
  asyncHandler(cancelFloodSimulation),
);
