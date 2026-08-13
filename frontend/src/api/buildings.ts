import { exportUrl, getJson, getRawJson } from './client';
import type { GeoJsonFeatureCollection } from './geometry';
import type { Building, BuildingGeoJsonProperties } from './types';
export function getBuilding(buildingId: string): Promise<Building> {
  return getJson<Building>(`/api/buildings/${buildingId}`);
}
export function listBuildingsPage(limit: number, offset: number): Promise<readonly Building[]> {
  return getJson<readonly Building[]>('/api/buildings', {
    limit: String(limit),
    offset: String(offset),
  });
}
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
