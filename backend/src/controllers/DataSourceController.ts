import type { Response } from 'express';
import { dataSourceService } from '../services';
import type { Pagination, ValidatedRequest } from '../validators';
import { sendData } from './respond';

/**
 * data_source (EDD Section 21). source_code is a plain text primary key,
 * not a UUID — unlike every other resource in this API — so the `:id`
 * route param is validated as a non-empty string (api/routes/dataSources.ts),
 * not uuidParamSchema.
 */

export async function listDataSources(
  req: ValidatedRequest<unknown, Pagination>,
  res: Response,
): Promise<void> {
  const dataSources = await dataSourceService.list(req.query);
  sendData(res, dataSources);
}

export async function getDataSourceById(
  req: ValidatedRequest<{ id: string }>,
  res: Response,
): Promise<void> {
  const dataSource = await dataSourceService.getById(req.params.id);
  sendData(res, dataSource);
}
