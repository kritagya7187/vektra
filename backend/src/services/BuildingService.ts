import type { Logger } from 'pino';
import { buildingRepository as defaultBuildingRepository } from '../repositories';
import type { Building } from '../models';
import type { BuildingRepository, ListOptions } from '../types';
import { rootLogger } from '../logging';
import { BaseService } from './BaseService';

/**
 * building (EDD Section 15, Static Layer): "immutable once ingested...
 * geometry never altered by any process, under any circumstance."
 * Read-only by construction — no update/delete method exists here
 * because none exists on BuildingRepository, because
 * vektra_backend_api has no UPDATE/DELETE grant on building
 * (db/migrations/0014). Immutability enforcement by omission, matching
 * every layer beneath this one.
 */
export class BuildingService extends BaseService {
  constructor(
    private readonly buildingRepository: BuildingRepository = defaultBuildingRepository,
    logger?: Logger,
  ) {
    super(logger ?? rootLogger.child({ component: 'service', service: 'BuildingService' }));
  }

  async getById(buildingId: string): Promise<Building> {
    const building = await this.buildingRepository.findById(buildingId);
    return this.assertFound(building, `Building '${buildingId}' not found.`);
  }

  async list(options?: ListOptions): Promise<readonly Building[]> {
    return this.buildingRepository.list(options);
  }
}

export const buildingService = new BuildingService();
