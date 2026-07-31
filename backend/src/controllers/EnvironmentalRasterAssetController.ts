import type { Response } from 'express';
import type { CsvColumn } from '../export';
import { fetchAllPages, sendCsv, toCsv } from '../export';
import type { EnvironmentalRasterAsset } from '../models';
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

export interface EnvironmentalRasterAssetExportQuery {
  readonly format: 'csv';
}

/**
 * Metadata only, per explicit instruction — spatialExtent (a real
 * geometry column) is deliberately excluded here, not omitted by
 * oversight.
 */
const ENVIRONMENTAL_RASTER_ASSET_CSV_COLUMNS: readonly CsvColumn<EnvironmentalRasterAsset>[] = [
  { header: 'rasterAssetId', value: (a) => a.rasterAssetId },
  { header: 'sourceCode', value: (a) => a.sourceCode },
  { header: 'acquisitionDate', value: (a) => a.acquisitionDate },
  { header: 'crs', value: (a) => a.crs },
  { header: 'resolutionM', value: (a) => a.resolutionM },
  { header: 'storageLocation', value: (a) => a.storageLocation },
  { header: 'provenanceId', value: (a) => a.provenanceId },
  { header: 'createdAt', value: (a) => a.createdAt },
  { header: 'updatedAt', value: (a) => a.updatedAt },
];

/** EDD FR-13 / Section 21. */
export async function exportEnvironmentalRasterAssets(
  req: ValidatedRequest<unknown, EnvironmentalRasterAssetExportQuery>,
  res: Response,
): Promise<void> {
  const assets = await fetchAllPages((options) => environmentalRasterAssetService.list(options));
  const csv = toCsv(assets, ENVIRONMENTAL_RASTER_ASSET_CSV_COLUMNS);
  req.log.info(
    { resource: 'environmentalRasterAsset', format: 'csv', rowCount: assets.length },
    'export completed',
  );
  sendCsv(res, 'environmental-raster-assets.csv', csv);
}
