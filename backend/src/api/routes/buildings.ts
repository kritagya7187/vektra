import { Router } from 'express';
import { getBuildingById, listBuildings } from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { paginationSchema, uuidParamSchema } from '../../validators';

export const buildingsRouter = Router();

buildingsRouter.get('/', validateRequest({ query: paginationSchema }), asyncHandler(listBuildings));
buildingsRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getBuildingById),
);
