import { Router } from 'express';
import { getDataProvenanceById, listDataProvenance } from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { paginationSchema, uuidParamSchema } from '../../validators';

export const dataProvenanceRouter = Router();

dataProvenanceRouter.get(
  '/',
  validateRequest({ query: paginationSchema }),
  asyncHandler(listDataProvenance),
);
dataProvenanceRouter.get(
  '/:id',
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(getDataProvenanceById),
);
