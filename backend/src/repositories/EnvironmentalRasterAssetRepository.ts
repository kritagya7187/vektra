import type { Database } from '../database';
import type { CreateEnvironmentalRasterAssetInput, EnvironmentalRasterAsset } from '../models';
import type { RasterDataSourceCode } from '../types';
import type {
  EnvironmentalRasterAssetRepository as EnvironmentalRasterAssetRepositoryContract,
  ListOptions,
} from '../types';
import type { GeoJsonPolygon } from '../types/geometry';
import { BaseRepository } from './BaseRepository';
import { toNumber } from './rowMapping';

const DEFAULT_LIST_LIMIT = 50;

interface EnvironmentalRasterAssetRow {
  readonly raster_asset_id: string;
  readonly source_code: string;
  readonly acquisition_date: Date; // DATE -> pg returns as Date, same as TIMESTAMPTZ
  readonly crs: string;
  readonly resolution_m: string; // NUMERIC -> pg returns as string
  readonly storage_location: string;
  readonly spatial_extent: GeoJsonPolygon; // ST_AsGeoJSON(...)::json -> already parsed
  readonly provenance_id: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapRow(row: EnvironmentalRasterAssetRow): EnvironmentalRasterAsset {
  return {
    rasterAssetId: row.raster_asset_id,
    sourceCode: row.source_code as RasterDataSourceCode,
    acquisitionDate: row.acquisition_date,
    crs: row.crs,
    resolutionM: toNumber(row.resolution_m),
    storageLocation: row.storage_location,
    spatialExtent: row.spatial_extent,
    provenanceId: row.provenance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `
  raster_asset_id, source_code, acquisition_date, crs, resolution_m, storage_location,
  ST_AsGeoJSON(spatial_extent)::json AS spatial_extent,
  provenance_id, created_at, updated_at
`;

/** environmental_raster_asset (db/migrations/0006). */
export class EnvironmentalRasterAssetRepositoryImpl
  extends BaseRepository
  implements EnvironmentalRasterAssetRepositoryContract
{
  async findById(
    rasterAssetId: string,
    executor?: Database,
  ): Promise<EnvironmentalRasterAsset | null> {
    const row = await this.queryOne<EnvironmentalRasterAssetRow>(
      'EnvironmentalRasterAssetRepository.findById',
      `SELECT ${COLUMNS} FROM environmental_raster_asset WHERE raster_asset_id = $1`,
      [rasterAssetId],
      executor,
    );
    return row ? mapRow(row) : null;
  }

  async list(
    options?: ListOptions,
    executor?: Database,
  ): Promise<readonly EnvironmentalRasterAsset[]> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options?.offset ?? 0;
    const rows = await this.queryMany<EnvironmentalRasterAssetRow>(
      'EnvironmentalRasterAssetRepository.list',
      `SELECT ${COLUMNS} FROM environmental_raster_asset ORDER BY acquisition_date DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
      executor,
    );
    return rows.map(mapRow);
  }

  /**
   * Remote Sensing Ingestion subsystem — the only writer
   * (db/migrations/0014 grants INSERT on environmental_raster_asset to
   * vektra_ingestion only). spatial_extent is a plain Polygon (not
   * MultiPolygon like building.geom_wgs84) — a scene/tile bounding
   * footprint, per migration 0006. Same ST_MakeValid() +
   * CHECK (ST_IsValid(...)) pattern as BuildingRepository.create() —
   * see that method's own note for why.
   */
  async create(
    input: CreateEnvironmentalRasterAssetInput,
    executor?: Database,
  ): Promise<EnvironmentalRasterAsset> {
    const row = await this.queryOne<EnvironmentalRasterAssetRow>(
      'EnvironmentalRasterAssetRepository.create',
      `INSERT INTO environmental_raster_asset
         (source_code, acquisition_date, crs, resolution_m, storage_location, spatial_extent, provenance_id)
       VALUES ($1, $2, $3, $4, $5, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)), $7)
       RETURNING ${COLUMNS}`,
      [
        input.sourceCode,
        input.acquisitionDate,
        input.crs,
        input.resolutionM,
        input.storageLocation,
        JSON.stringify(input.spatialExtent),
        input.provenanceId,
      ],
      executor,
    );
    if (!row) {
      throw new Error(
        'EnvironmentalRasterAssetRepository.create: INSERT RETURNING produced no row.',
      );
    }
    return mapRow(row);
  }
}

export const environmentalRasterAssetRepository = new EnvironmentalRasterAssetRepositoryImpl();
