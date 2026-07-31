import type { RasterDataSourceCode } from '../types/enums';
import type { GeoJsonPolygon } from '../types/geometry';

/**
 * environmental_raster_asset (db/migrations/0006). EnvironmentalRasterAsset
 * entity (EDD Section 16), Environmental Observation Layer (Section 15).
 * Metadata only — raw raster pixels are not stored in PostGIS.
 *
 * resolutionM is `number`, but the `pg` driver returns NUMERIC columns
 * as strings by default — see Building.ts's note; the same requirement
 * applies here.
 */
export interface EnvironmentalRasterAsset {
  readonly rasterAssetId: string;
  readonly sourceCode: RasterDataSourceCode;
  readonly acquisitionDate: Date;
  readonly crs: string;
  readonly resolutionM: number;
  readonly storageLocation: string;
  readonly spatialExtent: GeoJsonPolygon;
  readonly provenanceId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
