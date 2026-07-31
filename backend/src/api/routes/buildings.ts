import { Router } from 'express';
import { z } from 'zod';
import { exportBuildings, getBuildingById, listBuildings } from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { createEnumSchema, paginationSchema, uuidParamSchema } from '../../validators';

const buildingExportQuerySchema = z.object({
  format: createEnumSchema(['csv', 'geojson'] as const),
});

export const buildingsRouter = Router();

buildingsRouter.get('/', validateRequest({ query: paginationSchema }), asyncHandler(listBuildings));

// Must be registered before '/:id' — same route-ordering hazard as
// '/latest-baseline' in Subsystem 10: otherwise Express (and then
// uuidParamSchema) would try to treat the literal segment "export" as
// an :id value.
buildingsRouter.get(
  '/export',
  validateRequest({ query: buildingExportQuerySchema }),
  asyncHandler(exportBuildings),
);

buildingsRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getBuildingById),
);
