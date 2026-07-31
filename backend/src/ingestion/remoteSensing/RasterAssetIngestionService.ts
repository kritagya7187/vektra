import type { Logger } from 'pino';
import { database as defaultDatabase, type Database } from '../../database';
import { rootLogger } from '../../logging';
import {
  dataProvenanceRecordRepository as defaultDataProvenanceRecordRepository,
  environmentalRasterAssetRepository as defaultEnvironmentalRasterAssetRepository,
} from '../../repositories';
import {
  BaseService,
  dataSourceService as defaultDataSourceService,
  type DataSourceService,
} from '../../services';
import type {
  DataProvenanceRecordRepository,
  EnvironmentalRasterAssetRepository,
} from '../../types';
import { insertWithSavepointIsolation } from '../shared/savepointBatch';
import type {
  RasterDatasetClient,
  RasterDatasetMetadata,
  RasterIngestionSummary,
  RasterQuery,
  RasterSkippedItem,
} from './types';

/**
 * Bumped when THIS pipeline's extraction/mapping logic changes —
 * independent of backend/package.json's own version, mirroring
 * OsmIngestionService's INGESTION_PIPELINE_VERSION (Section 27:
 * ingestion_pipeline_version identifies the code that produced a batch).
 */
const INGESTION_PIPELINE_VERSION = '1.0.0';

/** Only one savepoint is ever open at a time (sequential, not concurrent) — same reasoning as OsmIngestionService's BUILDING_SAVEPOINT. */
const RASTER_SAVEPOINT = 'raster_ingestion_scene_insert';

export interface RasterAssetIngestionServiceDependencies {
  readonly dataSourceService?: DataSourceService;
  readonly dataProvenanceRecordRepository?: DataProvenanceRecordRepository;
  readonly environmentalRasterAssetRepository?: EnvironmentalRasterAssetRepository;
  readonly database?: Database;
  readonly logger?: Logger;
}

/**
 * One reusable service driving all 4 raster sources (Sentinel-2, Landsat,
 * ESA WorldCover, SRTM DEM) via dependency injection of a
 * RasterDatasetClient — the "Engineering Principles" brief's own
 * instruction to design this as a reusable framework rather than 4
 * near-identical services, mirroring OsmIngestionService's shape
 * (download -> transactional per-item registration with SAVEPOINT
 * isolation) but with a per-scene provenance model instead of OSM's
 * one-shared-provenance-many-children model: each discovered scene gets
 * its OWN DataProvenanceRecord, because each scene is an independently
 * versioned upstream product (its own acquisition date, its own
 * checksum), not a batch of rows extracted from one shared API response
 * the way OSM's Overpass query is. insertWithSavepointIsolation's
 * insertOne is deliberately free to perform more than one repository
 * call per item for exactly this reason — the provenance+asset pair for
 * one scene is atomic (both or neither), while a failure on one scene
 * never affects any other scene in the same run.
 */
export class RasterAssetIngestionService extends BaseService {
  private readonly dataSourceService: DataSourceService;
  private readonly dataProvenanceRecordRepository: DataProvenanceRecordRepository;
  private readonly environmentalRasterAssetRepository: EnvironmentalRasterAssetRepository;
  private readonly database: Database;
  private readonly client: RasterDatasetClient;

  constructor(client: RasterDatasetClient, deps: RasterAssetIngestionServiceDependencies = {}) {
    super(
      deps.logger ??
        rootLogger.child({
          component: 'ingestion',
          service: 'RasterAssetIngestionService',
          sourceCode: client.sourceCode,
        }),
    );
    this.client = client;
    this.dataSourceService = deps.dataSourceService ?? defaultDataSourceService;
    this.dataProvenanceRecordRepository =
      deps.dataProvenanceRecordRepository ?? defaultDataProvenanceRecordRepository;
    this.environmentalRasterAssetRepository =
      deps.environmentalRasterAssetRepository ?? defaultEnvironmentalRasterAssetRepository;
    this.database = deps.database ?? defaultDatabase;
  }

  async ingest(query: RasterQuery): Promise<RasterIngestionSummary> {
    const startedAt = Date.now();
    this.logger.info({ query }, 'raster ingestion started');

    // Existence validation + source of truth for license — never
    // re-hardcoded here, same as OsmIngestionService.
    const dataSource = await this.dataSourceService.getById(this.client.sourceCode);

    const scenes = await this.client.fetchMetadata(query);
    this.logger.info({ sceneCount: scenes.length }, 'metadata download complete');

    const retrievalTimestamp = new Date();
    const { succeeded, skipped } = await this.database.withTransaction((tx) =>
      insertWithSavepointIsolation({
        tx,
        items: scenes,
        savepointName: RASTER_SAVEPOINT,
        insertOne: async (scene: RasterDatasetMetadata, txExecutor) => {
          const provenance = await this.dataProvenanceRecordRepository.create(
            {
              sourceCode: dataSource.sourceCode,
              sourceProductIdentifier: scene.sourceProductIdentifier,
              retrievalTimestamp,
              license: dataSource.license,
              ingestionPipelineVersion: INGESTION_PIPELINE_VERSION,
              checksum: scene.checksum,
            },
            txExecutor,
          );
          return this.environmentalRasterAssetRepository.create(
            {
              sourceCode: this.client.sourceCode,
              acquisitionDate: scene.acquisitionDate,
              crs: scene.crs,
              resolutionM: scene.resolutionM,
              storageLocation: scene.storageLocation,
              spatialExtent: scene.spatialExtent,
              provenanceId: provenance.provenanceId,
            },
            txExecutor,
          );
        },
        onSkip: (scene, reason): RasterSkippedItem => ({
          sourceProductIdentifier: scene.sourceProductIdentifier,
          reason,
        }),
        logSkip: (scene, reason) => {
          this.logger.warn(
            { sourceProductIdentifier: scene.sourceProductIdentifier, reason },
            'skipped: registration failed',
          );
        },
      }),
    );

    const summary: RasterIngestionSummary = {
      sourceCode: this.client.sourceCode,
      totalDiscovered: scenes.length,
      registeredCount: succeeded.length,
      skippedCount: skipped.length,
      skipped,
      durationMs: Date.now() - startedAt,
    };

    this.logger.info(
      {
        // sourceCode deliberately omitted here — already bound into this
        // service's child logger context (constructor), so including it
        // again would emit a duplicate JSON key in the log line.
        totalDiscovered: summary.totalDiscovered,
        registeredCount: summary.registeredCount,
        skippedCount: summary.skippedCount,
        durationMs: summary.durationMs,
      },
      'raster ingestion completed',
    );

    return summary;
  }
}
