import type { Response } from 'express';
import type { CsvColumn } from '../export';
import { fetchAllPages, sendCsv, sendGeoJson, toCsv, toFeatureCollection } from '../export';
import type { Building } from '../models';
import { buildingService } from '../services';
import type { Pagination, UuidParam, ValidatedRequest } from '../validators';
import { sendData } from './respond';

/** building (EDD Section 15, 16, 21). Read-only, matching the service layer. */

export async function listBuildings(
  req: ValidatedRequest<unknown, Pagination>,
  res: Response,
): Promise<void> {
  const buildings = await buildingService.list(req.query);
  sendData(res, buildings);
}

export async function getBuildingById(
  req: ValidatedRequest<UuidParam>,
  res: Response,
): Promise<void> {
  const building = await buildingService.getById(req.params.id);
  sendData(res, building);
}

export interface BuildingExportQuery {
  readonly format: 'csv' | 'geojson';
}

/**
 * Scalar fields only — geometry doesn't belong in a CSV cell (EDD
 * FR-13's "tabular format"). Export the same resource as GeoJSON
 * instead if geometry is needed.
 */
const BUILDING_CSV_COLUMNS: readonly CsvColumn<Building>[] = [
  { header: 'buildingId', value: (b) => b.buildingId },
  { header: 'osmId', value: (b) => b.osmId },
  { header: 'osmType', value: (b) => b.osmType },
  { header: 'buildingTagType', value: (b) => b.buildingTagType },
  { header: 'name', value: (b) => b.name },
  { header: 'heightM', value: (b) => b.heightM },
  { header: 'buildingLevels', value: (b) => b.buildingLevels },
  { header: 'footprintAreaSqm', value: (b) => b.footprintAreaSqm },
  { header: 'provenanceId', value: (b) => b.provenanceId },
  { header: 'createdAt', value: (b) => b.createdAt },
  { header: 'updatedAt', value: (b) => b.updatedAt },
];

function buildingGeoJsonProperties(b: Building): Omit<Building, 'geomWgs84' | 'geomUtm43n'> {
  const { geomWgs84: _geomWgs84, geomUtm43n: _geomUtm43n, ...properties } = b;
  return properties;
}

/**
 * EDD FR-13 / Section 21 ("Export services (CSV, GeoJSON) for the
 * above"). Geometry (geomWgs84) becomes the Feature's geometry, not a
 * property — including it again inside properties would duplicate the
 * same coordinates in two shapes on every feature. geomUtm43n is
 * excluded from properties for the same reason (a second, redundant
 * representation of the same footprint).
 */
export async function exportBuildings(
  req: ValidatedRequest<unknown, BuildingExportQuery>,
  res: Response,
): Promise<void> {
  const buildings = await fetchAllPages((options) => buildingService.list(options));

  if (req.query.format === 'csv') {
    const csv = toCsv(buildings, BUILDING_CSV_COLUMNS);
    req.log.info(
      { resource: 'building', format: 'csv', rowCount: buildings.length },
      'export completed',
    );
    sendCsv(res, 'buildings.csv', csv);
    return;
  }

  const featureCollection = toFeatureCollection(
    buildings,
    (b) => b.geomWgs84,
    buildingGeoJsonProperties,
  );
  req.log.info(
    { resource: 'building', format: 'geojson', rowCount: buildings.length },
    'export completed',
  );
  sendGeoJson(res, 'buildings.geojson', featureCollection);
}
