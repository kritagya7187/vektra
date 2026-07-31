import type { Response } from 'express';
import { dataProvenanceService } from '../services';
import type { Pagination, UuidParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

/** data_provenance_record (EDD Section 21: "Query provenance metadata for any served record"). */

export async function listDataProvenance(
  req: ValidatedRequest<unknown, Pagination>,
  res: Response,
): Promise<void> {
  const records = await dataProvenanceService.list(req.query);
  sendData(res, records);
}

export async function getDataProvenanceById(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const record = await dataProvenanceService.getById(req.params.id);
  sendData(res, record);
}
