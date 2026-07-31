import { Router } from 'express';
import { z } from 'zod';
import {
  exportEnvironmentalRasterAssets,
  getEnvironmentalRasterAssetById,
  listEnvironmentalRasterAssets,
} from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { createEnumSchema, paginationSchema, uuidParamSchema } from '../../validators';

const environmentalRasterAssetExportQuerySchema = z.object({
  format: createEnumSchema(['csv'] as const),
});

export const environmentalRasterAssetsRouter = Router();

environmentalRasterAssetsRouter.get(
  '/',
  validateRequest({ query: paginationSchema }),
  asyncHandler(listEnvironmentalRasterAssets),
);

// Before '/:id' — same route-ordering hazard noted throughout this API.
environmentalRasterAssetsRouter.get(
  '/export',
  validateRequest({ query: environmentalRasterAssetExportQuerySchema }),
  asyncHandler(exportEnvironmentalRasterAssets),
);

environmentalRasterAssetsRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getEnvironmentalRasterAssetById),
);
