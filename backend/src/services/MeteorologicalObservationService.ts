import type { Logger } from 'pino';
import { meteorologicalObservationRepository as defaultMeteorologicalObservationRepository } from '../repositories';
import type { MeteorologicalObservation } from '../models';
import type { ListOptions, MeteorologicalObservationRepository } from '../types';
import { rootLogger } from '../logging';
import { BaseService } from './BaseService';

/**
 * meteorological_observation (EDD Section 15, Environmental Layer):
 * immutable once ingested. Read-only — no INSERT/UPDATE grant to
 * vektra_backend_api (db/migrations/0014); ingestion owns this table.
 */
export class MeteorologicalObservationService extends BaseService {
  constructor(
    private readonly meteorologicalObservationRepository: MeteorologicalObservationRepository = defaultMeteorologicalObservationRepository,
    logger?: Logger,
  ) {
    super(
      logger ??
        rootLogger.child({ component: 'service', service: 'MeteorologicalObservationService' }),
    );
  }

  async getById(metObservationId: string): Promise<MeteorologicalObservation> {
    const observation = await this.meteorologicalObservationRepository.findById(metObservationId);
    return this.assertFound(
      observation,
      `Meteorological observation '${metObservationId}' not found.`,
    );
  }

  async list(options?: ListOptions): Promise<readonly MeteorologicalObservation[]> {
    return this.meteorologicalObservationRepository.list(options);
  }
}

export const meteorologicalObservationService = new MeteorologicalObservationService();
