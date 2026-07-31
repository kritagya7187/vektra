import type { Database } from '../database';
import type { Building, CreateBuildingInput } from '../models';
import type { OsmType } from '../types';
import type { BuildingRepository as BuildingRepositoryContract, ListOptions } from '../types';
import type { GeoJsonMultiPolygon } from '../types/geometry';
import { BaseRepository } from './BaseRepository';
import { toNullableNumber, toNumber } from './rowMapping';

const DEFAULT_LIST_LIMIT = 50;

interface BuildingRow {
  readonly building_id: string;
  readonly osm_id: string; // BIGINT -> pg returns as string
  readonly osm_type: string;
  readonly building_tag_type: string | null;
  readonly name: string | null;
  readonly height_m: string | null; // NUMERIC -> pg returns as string
  readonly building_levels: number | null; // INTEGER -> pg returns as real number
  readonly geom_wgs84: GeoJsonMultiPolygon; // ST_AsGeoJSON(...)::json -> already parsed
  readonly geom_utm43n: GeoJsonMultiPolygon | null;
  readonly footprint_area_sqm: string | null; // NUMERIC -> pg returns as string
  readonly provenance_id: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/**
 * geomUtm43n's GeoJSON coordinates are UTM 43N meters, not WGS84 degrees
 * — ST_AsGeoJSON() serializes whatever CRS the geometry already has, it
 * does not reproject. Using the GeoJsonMultiPolygon TS shape here is a
 * convenient, internally-consistent structure, not a claim of RFC 7946
 * compliance for this specific column; that compliance applies to
 * geomWgs84.
 */
function mapRow(row: BuildingRow): Building {
  return {
    buildingId: row.building_id,
    osmId: toNumber(row.osm_id),
    osmType: row.osm_type as OsmType,
    buildingTagType: row.building_tag_type,
    name: row.name,
    heightM: toNullableNumber(row.height_m),
    buildingLevels: row.building_levels,
    geomWgs84: row.geom_wgs84,
    geomUtm43n: row.geom_utm43n,
    footprintAreaSqm: toNullableNumber(row.footprint_area_sqm),
    provenanceId: row.provenance_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `
  building_id, osm_id, osm_type, building_tag_type, name, height_m, building_levels,
  ST_AsGeoJSON(geom_wgs84)::json AS geom_wgs84,
  ST_AsGeoJSON(geom_utm43n)::json AS geom_utm43n,
  footprint_area_sqm, provenance_id, created_at, updated_at
`;

/** building (db/migrations/0005). */
export class BuildingRepositoryImpl extends BaseRepository implements BuildingRepositoryContract {
  async findById(buildingId: string, executor?: Database): Promise<Building | null> {
    const row = await this.queryOne<BuildingRow>(
      'BuildingRepository.findById',
      `SELECT ${COLUMNS} FROM building WHERE building_id = $1`,
      [buildingId],
      executor,
    );
    return row ? mapRow(row) : null;
  }

  async list(options?: ListOptions, executor?: Database): Promise<readonly Building[]> {
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options?.offset ?? 0;
    const rows = await this.queryMany<BuildingRow>(
      'BuildingRepository.list',
      `SELECT ${COLUMNS} FROM building ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
      executor,
    );
    return rows.map(mapRow);
  }

  /**
   * OSM Ingestion subsystem — the only writer (db/migrations/0014 grants
   * INSERT on building to vektra_ingestion only). geom_utm43n and
   * footprint_area_sqm are never supplied here: the former is
   * auto-derived by fn_populate_building_utm_geometry, the latter is a
   * generated column (db/migrations/0005) — both computed by the
   * database itself, not this repository.
   *
   * ST_MakeValid() wraps the constructed geometry so a topologically
   * invalid (but structurally sound — closed, non-empty, in-range)
   * input polygon is repaired by PostGIS's own standard tool rather than
   * a hand-rolled repair. The existing CHECK (ST_IsValid(geom_wgs84))
   * constraint is the final backstop: if ST_MakeValid() cannot produce a
   * valid MultiPolygon, the INSERT itself fails — "reject unrecoverable
   * geometries" enforced by the schema, not application logic.
   */
  async create(input: CreateBuildingInput, executor?: Database): Promise<Building> {
    const row = await this.queryOne<BuildingRow>(
      'BuildingRepository.create',
      `INSERT INTO building (osm_id, osm_type, building_tag_type, name, height_m, building_levels, geom_wgs84, provenance_id)
       VALUES ($1, $2, $3, $4, $5, $6, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)), $8)
       RETURNING ${COLUMNS}`,
      [
        input.osmId,
        input.osmType,
        input.buildingTagType,
        input.name,
        input.heightM,
        input.buildingLevels,
        JSON.stringify(input.geomWgs84),
        input.provenanceId,
      ],
      executor,
    );
    if (!row) {
      throw new Error('BuildingRepository.create: INSERT RETURNING produced no row.');
    }
    return mapRow(row);
  }

  /**
   * Heat Exposure Engine subsystem: the exact building set belonging to
   * ONE resolved OSM provenance batch, not every building ever ingested
   * across every re-ingestion (see this subsystem's engineering
   * review). ORDER BY building_id keeps iteration order stable/
   * deterministic across runs, though the resulting row SET is identical
   * regardless of order.
   */
  async listByProvenanceId(
    provenanceId: string,
    executor?: Database,
  ): Promise<readonly Building[]> {
    const rows = await this.queryMany<BuildingRow>(
      'BuildingRepository.listByProvenanceId',
      `SELECT ${COLUMNS} FROM building WHERE provenance_id = $1 ORDER BY building_id ASC`,
      [provenanceId],
      executor,
    );
    return rows.map(mapRow);
  }
}

export const buildingRepository = new BuildingRepositoryImpl();
