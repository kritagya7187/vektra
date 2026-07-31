import { Router } from 'express';
import { z } from 'zod';
import {
  createScenario,
  exportScenarios,
  getScenarioById,
  getScenarioComparison,
  listScenarios,
} from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import {
  createEnumSchema,
  nonEmptyStringSchema,
  paginationSchema,
  uuidParamSchema,
  uuidSchema,
} from '../../validators';

/**
 * Structural validation only — types and required fields. The business
 * rules ScenarioService (Subsystem 9) already enforces (non-empty
 * overrides, no duplicate (buildingId, attributeName) pairs, baseline
 * run must exist/be type=baseline/be completed, every building must
 * exist) are deliberately NOT re-checked here; doing so would duplicate
 * validation the service layer already owns. `overrides` is intentionally
 * NOT `.min(1)` for the same reason — an empty array is structurally
 * valid JSON, and the service is the one place that rejects it.
 */
const createScenarioOverrideSchema = z.object({
  buildingId: uuidSchema,
  attributeName: nonEmptyStringSchema(),
  overrideValue: nonEmptyStringSchema(),
});

const createScenarioBodySchema = z.object({
  baselineRunId: uuidSchema,
  name: nonEmptyStringSchema(),
  description: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  overrides: z.array(createScenarioOverrideSchema),
});

const scenarioExportQuerySchema = z.object({
  format: createEnumSchema(['csv'] as const),
});

export const scenariosRouter = Router();

scenariosRouter.get('/', validateRequest({ query: paginationSchema }), asyncHandler(listScenarios));
scenariosRouter.post(
  '/',
  validateRequest({ body: createScenarioBodySchema }),
  asyncHandler(createScenario),
);

// Before '/:id' — same route-ordering hazard noted throughout this API.
scenariosRouter.get(
  '/export',
  validateRequest({ query: scenarioExportQuerySchema }),
  asyncHandler(exportScenarios),
);

scenariosRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getScenarioById),
);
scenariosRouter.get(
  '/:id/comparison',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getScenarioComparison),
);
