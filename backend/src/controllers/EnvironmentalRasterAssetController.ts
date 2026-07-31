import type { Response } from 'express';
import { environmentalRasterAssetService } from '../services';
import type { Pagination, UuidParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

/** environmental_raster_asset (EDD Section 15, 16, 21). Read-only. */

export async function listEnvironmentalRasterAssets(
  req: ValidatedRequest<unknown, Pagination>,
  res: Response,
): Promise<void> {
  const assets = await environmentalRasterAssetService.list(req.query);
  sendData(res, assets);
}

export async function getEnvironmentalRasterAssetById(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const asset = await environmentalRasterAssetService.getById(req.params.id);
  sendData(res, asset);
}
