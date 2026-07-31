import { Router } from 'express';
import { getEnvironmentalRasterAssetById, listEnvironmentalRasterAssets } from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { paginationSchema, uuidParamSchema } from '../../validators';

export const environmentalRasterAssetsRouter = Router();

environmentalRasterAssetsRouter.get(
  '/',
  validateRequest({ query: paginationSchema }),
  asyncHandler(listEnvironmentalRasterAssets),
);
environmentalRasterAssetsRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getEnvironmentalRasterAssetById),
);
