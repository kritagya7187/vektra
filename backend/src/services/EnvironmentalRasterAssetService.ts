import type { Logger } from 'pino';
import { environmentalRasterAssetRepository as defaultEnvironmentalRasterAssetRepository } from '../repositories';
import type { EnvironmentalRasterAsset } from '../models';
import type { EnvironmentalRasterAssetRepository, ListOptions } from '../types';
import { rootLogger } from '../logging';
import { BaseService } from './BaseService';

/**
 * environmental_raster_asset (EDD Section 15, Environmental Layer):
 * immutable once ingested. Read-only — no INSERT/UPDATE grant to
 * vektra_backend_api (db/migrations/0014); ingestion owns this table.
 *
 * A spatial "raster assets covering this building" query (Section 18's
 * overlay concept) is a real future capability, but it needs a
 * repository method that doesn't exist yet and no caller has asked for
 * a concrete shape — deferred rather than guessed at here.
 */
export class EnvironmentalRasterAssetService extends BaseService {
  constructor(
    private readonly environmentalRasterAssetRepository: EnvironmentalRasterAssetRepository = defaultEnvironmentalRasterAssetRepository,
    logger?: Logger,
  ) {
    super(
      logger ??
        rootLogger.child({ component: 'service', service: 'EnvironmentalRasterAssetService' }),
    );
  }

  async getById(rasterAssetId: string): Promise<EnvironmentalRasterAsset> {
    const asset = await this.environmentalRasterAssetRepository.findById(rasterAssetId);
    return this.assertFound(asset, `Environmental raster asset '${rasterAssetId}' not found.`);
  }

  async list(options?: ListOptions): Promise<readonly EnvironmentalRasterAsset[]> {
    return this.environmentalRasterAssetRepository.list(options);
  }
}

export const environmentalRasterAssetService = new EnvironmentalRasterAssetService();
