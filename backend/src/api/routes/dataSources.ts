import { Router } from 'express';
import { z } from 'zod';
import { getDataSourceById, listDataSources } from '../../controllers';
import { asyncHandler, validateRequest } from '../../middleware';
import { nonEmptyStringSchema, paginationSchema } from '../../validators';

/**
 * source_code is a plain text primary key (db/migrations/0003), not a
 * UUID — the one resource in this API where uuidParamSchema doesn't
 * apply.
 */
const dataSourceIdParamSchema = z.object({ id: nonEmptyStringSchema() });

export const dataSourcesRouter = Router();

dataSourcesRouter.get(
  '/',
  validateRequest({ query: paginationSchema }),
  asyncHandler(listDataSources),
);
dataSourcesRouter.get(
  '/:id',
  validateRequest({ params: dataSourceIdParamSchema }),
  asyncHandler(getDataSourceById),
);
