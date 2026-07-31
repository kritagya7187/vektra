import type { Logger } from 'pino';
import { database as defaultDatabase, type Database } from '../../database';
import { rootLogger } from '../../logging';
import {
  dataProvenanceRecordRepository as defaultDataProvenanceRecordRepository,
  meteorologicalObservationRepository as defaultMeteorologicalObservationRepository,
} from '../../repositories';
import {
  BaseService,
  dataSourceService as defaultDataSourceService,
  type DataSourceService,
} from '../../services';
import type {
  DataProvenanceRecordRepository,
  MeteorologicalObservationRepository,
} from '../../types';
import type { GeoJsonPoint } from '../../types/geometry';
import { insertWithSavepointIsolation } from '../shared/savepointBatch';
import type {
  MeteorologicalIngestionSummary,
  MeteorologicalObservationClient,
  MeteorologicalObservationValue,
  MeteorologicalQuery,
  MeteorologicalSkippedItem,
} from './types';

/** Independent of backend/package.json's own version — same reasoning as the other two ingestion services' pipeline version constants. */
const INGESTION_PIPELINE_VERSION = '1.0.0';

/** Only one savepoint is ever open at a time — same reasoning as the other two ingestion services. */
const OBSERVATION_SAVEPOINT = 'meteorological_ingestion_observation_insert';

export interface MeteorologicalIngestionServiceDependencies {
  readonly dataSourceService?: DataSourceService;
  readonly dataProvenanceRecordRepository?: DataProvenanceRecordRepository;
  readonly meteorologicalObservationRepository?: MeteorologicalObservationRepository;
  readonly database?: Database;
  readonly logger?: Logger;
}

function describeSourceProduct(query: MeteorologicalQuery): string {
  return `open_meteo:${query.latitude},${query.longitude}:${query.from.toISOString()}/${query.to.toISOString()}`;
}

/**
 * Orchestrates Open-Meteo observation ingestion (this subsystem's own
 * brief, item 4): OpenMeteoClient (download) -> one Database.
 * withTransaction() creating ONE shared DataProvenanceRecord (this query
 * — one location, one time range — is a single retrieval, not a
 * per-scene product the way each raster asset is) and every
 * MeteorologicalObservation row through the repository layer, with
 * per-observation SAVEPOINT isolation. Shape mirrors OsmIngestionService
 * (one shared provenance, many child rows) rather than
 * RasterAssetIngestionService (one provenance per item) — see this
 * subsystem's review for why the two ingestion targets in this
 * subsystem use different provenance shapes.
 */
export class MeteorologicalIngestionService extends BaseService {
  private readonly dataSourceService: DataSourceService;
  private readonly dataProvenanceRecordRepository: DataProvenanceRecordRepository;
  private readonly meteorologicalObservationRepository: MeteorologicalObservationRepository;
  private readonly database: Database;
  private readonly client: MeteorologicalObservationClient;

  constructor(
    client: MeteorologicalObservationClient,
    deps: MeteorologicalIngestionServiceDependencies = {},
  ) {
    super(
      deps.logger ??
        rootLogger.child({
          component: 'ingestion',
          service: 'MeteorologicalIngestionService',
          sourceCode: client.sourceCode,
        }),
    );
    this.client = client;
    this.dataSourceService = deps.dataSourceService ?? defaultDataSourceService;
    this.dataProvenanceRecordRepository =
      deps.dataProvenanceRecordRepository ?? defaultDataProvenanceRecordRepository;
    this.meteorologicalObservationRepository =
      deps.meteorologicalObservationRepository ?? defaultMeteorologicalObservationRepository;
    this.database = deps.database ?? defaultDatabase;
  }

  async ingest(query: MeteorologicalQuery): Promise<MeteorologicalIngestionSummary> {
    const startedAt = Date.now();
    this.logger.info({ query }, 'meteorological ingestion started');

    const dataSource = await this.dataSourceService.getById(this.client.sourceCode);

    const observations = await this.client.fetchObservations(query);
    this.logger.info({ observationCount: observations.length }, 'observation download complete');

    const location: GeoJsonPoint = {
      type: 'Point',
      coordinates: [query.longitude, query.latitude],
    };
    const retrievalTimestamp = new Date();

    const { provenanceId, insertedCount, insertSkipped } = await this.database.withTransaction(
      async (tx) => {
        const provenance = await this.dataProvenanceRecordRepository.create(
          {
            sourceCode: dataSource.sourceCode,
            sourceProductIdentifier: describeSourceProduct(query),
            retrievalTimestamp,
            license: dataSource.license,
            ingestionPipelineVersion: INGESTION_PIPELINE_VERSION,
          },
          tx,
        );
        this.logger.info({ provenanceId: provenance.provenanceId }, 'provenance record created');

        const { succeeded, skipped } = await insertWithSavepointIsolation({
          tx,
          items: observations,
          savepointName: OBSERVATION_SAVEPOINT,
          insertOne: (observation: MeteorologicalObservationValue, txExecutor) =>
            this.meteorologicalObservationRepository.create(
              {
                sourceCode: this.client.sourceCode,
                observationTimestamp: observation.timestamp,
                location,
                variableName: observation.variableName,
                variableValue: observation.variableValue,
                variableUnit: observation.variableUnit,
                provenanceId: provenance.provenanceId,
              },
              txExecutor,
            ),
          onSkip: (observation, reason): MeteorologicalSkippedItem => ({
            timestamp: observation.timestamp.toISOString(),
            variableName: observation.variableName,
            reason,
          }),
          logSkip: (observation, reason) => {
            this.logger.warn(
              { timestamp: observation.timestamp, variableName: observation.variableName, reason },
              'skipped: insert failed',
            );
          },
        });

        return {
          provenanceId: provenance.provenanceId,
          insertedCount: succeeded.length,
          insertSkipped: skipped,
        };
      },
    );

    const summary: MeteorologicalIngestionSummary = {
      provenanceId,
      totalObservationsReturned: observations.length,
      insertedCount,
      skippedCount: insertSkipped.length,
      skipped: insertSkipped,
      durationMs: Date.now() - startedAt,
    };

    this.logger.info(
      {
        provenanceId: summary.provenanceId,
        totalObservationsReturned: summary.totalObservationsReturned,
        insertedCount: summary.insertedCount,
        skippedCount: summary.skippedCount,
        durationMs: summary.durationMs,
      },
      'meteorological ingestion completed',
    );

    return summary;
  }
}
