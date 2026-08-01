import { exportUrl, getJson, getRawJson } from './client';
import type { GeoJsonFeatureCollection } from './geometry';
import type { Building, BuildingGeoJsonProperties } from './types';

/**
 * GET /buildings, /buildings/:id, /buildings/export?format=geojson —
 * backend/src/api/routes/buildings.ts exactly. list() is NOT scoped to
 * any provenance batch (no such query parameter exists on this route) —
 * see the design review §7 for why the run-scoped building set is
 * reconstructed client-side instead of inventing a new backend filter.
 */

export function getBuilding(buildingId: string): Promise<Building> {
  return getJson<Building>(`/api/buildings/${buildingId}`);
}

export function listBuildingsPage(limit: number, offset: number): Promise<readonly Building[]> {
  return getJson<readonly Building[]>('/api/buildings', {
    limit: String(limit),
    offset: String(offset),
  });
}

/** The full building set as GeoJSON, across every ingestion batch — fetched once and filtered client-side per §7. */
export function fetchAllBuildingsGeoJson(): Promise<
  GeoJsonFeatureCollection<BuildingGeoJsonProperties>
> {
  return getRawJson<GeoJsonFeatureCollection<BuildingGeoJsonProperties>>('/api/buildings/export', {
    format: 'geojson',
  });
}

export function buildingsCsvExportUrl(): string {
  return exportUrl('/api/buildings/export', { format: 'csv' });
}

export function buildingsGeoJsonExportUrl(): string {
  return exportUrl('/api/buildings/export', { format: 'geojson' });
}
