import type { Logger } from 'pino';
import { config } from '../config';
import { database as defaultDatabase, type Database } from '../database';
import { isAppError } from '../errors';
import { rootLogger } from '../logging';
import {
  buildingRepository as defaultBuildingRepository,
  dataProvenanceRecordRepository as defaultDataProvenanceRecordRepository,
} from '../repositories';
import {
  BaseService,
  dataSourceService as defaultDataSourceService,
  type DataSourceService,
} from '../services';
import type { BuildingRepository, DataProvenanceRecordRepository } from '../types';
import type { GeoJsonMultiPolygon } from '../types/geometry';
import { OverpassClient } from './osm/OverpassClient';
import { processGeometry } from './osm/geometry';
import {
  parseBuildingLevels,
  parseHeightMeters,
  parseOverpassResponse,
} from './osm/parseOverpassResponse';
import { buildBuildingFootprintQuery } from './osm/overpassQueryBuilder';
import type { IngestionArea, IngestionCandidate, IngestionSummary, SkippedFeature } from './types';

/**
 * Bumped when THIS pipeline's extraction/validation/mapping logic
 * changes — independent of backend/package.json's own version, which
 * tracks the whole API service (Section 27: ingestion_pipeline_version
 * identifies the code that produced a batch, not the deploying service).
 */
const INGESTION_PIPELINE_VERSION = '1.0.0';

const OSM_OVERPASS_SOURCE_CODE = 'osm_overpass';

/** SAVEPOINT name doesn't need to vary per row — only one is ever open at a time (sequential, not concurrent). */
const BUILDING_SAVEPOINT = 'osm_ingestion_building_insert';

export interface OsmIngestionServiceDependencies {
  readonly dataSourceService?: DataSourceService;
  readonly dataProvenanceRecordRepository?: DataProvenanceRecordRepository;
  readonly buildingRepository?: BuildingRepository;
  readonly database?: Database;
  readonly overpassClient?: OverpassClient;
  readonly logger?: Logger;
}

function describeSourceProduct(area: IngestionArea): string {
  if (area.kind === 'bbox') {
    const { minLon, minLat, maxLon, maxLat } = area.bbox;
    return `bbox:${minLon},${minLat},${maxLon},${maxLat}`;
  }
  return `area:${area.areaName}`;
}

function describeFailureReason(err: unknown): string {
  // Only ever an already-safe AppError message (never a raw driver
  // error) — matches "never expose persistence details" everywhere else
  // in this codebase.
  return isAppError(err) ? err.message : 'insert failed';
}

/**
 * Orchestrates OSM building ingestion (FR-1): OverpassClient (download)
 * -> parseOverpassResponse (extract) -> processGeometry (validate/
 * repair) -> in-memory dedup -> one Database.withTransaction() creating
 * the DataProvenanceRecord and every Building through the repository
 * layer, with per-building SAVEPOINT isolation (see this subsystem's
 * review for why savepoints are required, not optional, for this
 * behavior). Never touches SQL directly — every persistence call goes
 * through buildingRepository/dataProvenanceRecordRepository.
 */
export class OsmIngestionService extends BaseService {
  private readonly dataSourceService: DataSourceService;
  private readonly dataProvenanceRecordRepository: DataProvenanceRecordRepository;
  private readonly buildingRepository: BuildingRepository;
  private readonly database: Database;
  private readonly overpassClient: OverpassClient;

  constructor(deps: OsmIngestionServiceDependencies = {}) {
    super(
      deps.logger ?? rootLogger.child({ component: 'ingestion', service: 'OsmIngestionService' }),
    );
    this.dataSourceService = deps.dataSourceService ?? defaultDataSourceService;
    this.dataProvenanceRecordRepository =
      deps.dataProvenanceRecordRepository ?? defaultDataProvenanceRecordRepository;
    this.buildingRepository = deps.buildingRepository ?? defaultBuildingRepository;
    this.database = deps.database ?? defaultDatabase;
    this.overpassClient =
      deps.overpassClient ??
      new OverpassClient({
        apiUrl: config.overpass.apiUrl,
        timeoutMs: config.overpass.timeoutMs,
        maxRetries: config.overpass.maxRetries,
        logger: this.logger,
      });
  }

  async ingest(area: IngestionArea): Promise<IngestionSummary> {
    const startedAt = Date.now();
    this.logger.info({ area }, 'ingestion started');

    // Existence validation (BaseService.assertFound, via the existing
    // service) + source of truth for license/sourceCode — never
    // re-hardcoded here.
    const dataSource = await this.dataSourceService.getById(OSM_OVERPASS_SOURCE_CODE);

    const query = buildBuildingFootprintQuery(area, Math.ceil(config.overpass.timeoutMs / 1000));
    const elements = await this.overpassClient.fetchElements(query);

    this.logger.info({ elementCount: elements.length }, 'parsing OSM response');
    const candidates = parseOverpassResponse({ elements }, this.logger);
    this.logger.info({ candidateCount: candidates.length }, 'parsing complete');

    const deduped = this.deduplicate(candidates);

    const structurallySkipped: SkippedFeature[] = [];
    const toInsert: { candidate: IngestionCandidate; geoJson: GeoJsonMultiPolygon }[] = [];
    for (const candidate of deduped) {
      const outcome = processGeometry(candidate.rings);
      if (outcome.status === 'rejected') {
        this.logger.warn(
          { osmId: candidate.osmId, osmType: candidate.osmType, reason: outcome.reason },
          'skipped: geometry validation failed',
        );
        structurallySkipped.push({
          osmId: candidate.osmId,
          osmType: candidate.osmType,
          reason: outcome.reason,
        });
        continue;
      }
      toInsert.push({ candidate, geoJson: outcome.geoJson });
    }

    const retrievalTimestamp = new Date();
    const { provenanceId, insertedCount, insertSkipped } = await this.database.withTransaction(
      async (tx) => {
        const provenance = await this.dataProvenanceRecordRepository.create(
          {
            sourceCode: dataSource.sourceCode,
            sourceProductIdentifier: describeSourceProduct(area),
            retrievalTimestamp,
            license: dataSource.license,
            ingestionPipelineVersion: INGESTION_PIPELINE_VERSION,
          },
          tx,
        );
        this.logger.info({ provenanceId: provenance.provenanceId }, 'provenance record created');

        let inserted = 0;
        const skippedInTx: SkippedFeature[] = [];

        for (const { candidate, geoJson } of toInsert) {
          await tx.query(`SAVEPOINT ${BUILDING_SAVEPOINT}`);
          try {
            await this.buildingRepository.create(
              {
                osmId: candidate.osmId,
                osmType: candidate.osmType,
                buildingTagType: candidate.attributes.building,
                name: candidate.attributes.name,
                heightM: parseHeightMeters(candidate.attributes.height),
                buildingLevels: parseBuildingLevels(candidate.attributes.buildingLevels),
                geomWgs84: geoJson,
                provenanceId: provenance.provenanceId,
              },
              tx,
            );
            await tx.query(`RELEASE SAVEPOINT ${BUILDING_SAVEPOINT}`);
            inserted += 1;
          } catch (err) {
            await tx.query(`ROLLBACK TO SAVEPOINT ${BUILDING_SAVEPOINT}`);
            const reason = describeFailureReason(err);
            this.logger.warn(
              { osmId: candidate.osmId, osmType: candidate.osmType, reason },
              'skipped: insert failed',
            );
            skippedInTx.push({ osmId: candidate.osmId, osmType: candidate.osmType, reason });
          }
        }

        return {
          provenanceId: provenance.provenanceId,
          insertedCount: inserted,
          insertSkipped: skippedInTx,
        };
      },
    );

    const skipped = [...structurallySkipped, ...insertSkipped];
    const summary: IngestionSummary = {
      provenanceId,
      totalFeaturesReturned: elements.length,
      insertedCount,
      skippedCount: skipped.length,
      skipped,
      durationMs: Date.now() - startedAt,
    };

    this.logger.info(
      {
        provenanceId: summary.provenanceId,
        totalFeaturesReturned: summary.totalFeaturesReturned,
        insertedCount: summary.insertedCount,
        skippedCount: summary.skippedCount,
        durationMs: summary.durationMs,
      },
      'ingestion completed',
    );

    return summary;
  }

  /**
   * Within-run dedup (this subsystem's deduplication strategy, part 1 of
   * 2 — see review). Backed by the schema's own
   * uq_building_osm_snapshot UNIQUE (osm_id, osm_type, provenance_id) as
   * a hard safety net if this in-memory check were ever bypassed.
   */
  private deduplicate(candidates: readonly IngestionCandidate[]): readonly IngestionCandidate[] {
    const seen = new Set<string>();
    const deduped: IngestionCandidate[] = [];
    for (const candidate of candidates) {
      const key = `${candidate.osmType}:${candidate.osmId}`;
      if (seen.has(key)) {
        this.logger.warn(
          { osmId: candidate.osmId, osmType: candidate.osmType },
          'duplicate element within this run, skipping',
        );
        continue;
      }
      seen.add(key);
      deduped.push(candidate);
    }
    return deduped;
  }
}

export const osmIngestionService = new OsmIngestionService();
