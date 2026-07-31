import type { IngestionArea } from '../types';

/**
 * Pure — no I/O, no config, no logging. Generates Overpass QL for
 * building footprints only (FR-1: "ingest building footprint polygons").
 *
 * `out geom;` returns full inline coordinate geometry for matched
 * ways/relations in one response, avoiding a second node-resolution
 * pass — the standard, documented way to fetch footprints from
 * Overpass without reconstructing geometry from separate node IDs.
 *
 * Scoped to `["building"]`-tagged ways and multipolygon relations only
 * — never nodes (a single point tagged building=yes has no footprint to
 * ingest), never any other OSM object class (roads, trees, water,
 * amenities) is queried at all, so "ingest only building polygons" is
 * enforced by the query itself, not filtered out afterward.
 *
 * Never hardcodes an area name — always takes one as a parameter.
 */

const AREA_NAME_FORBIDDEN_CHARS = /["\\]/;

function assertSafeAreaName(areaName: string): void {
  if (areaName.trim().length === 0) {
    throw new Error('areaName must not be empty.');
  }
  if (AREA_NAME_FORBIDDEN_CHARS.test(areaName)) {
    throw new Error('areaName must not contain quote or backslash characters.');
  }
}

export function buildBuildingFootprintQuery(area: IngestionArea, timeoutSeconds: number): string {
  const header = `[out:json][timeout:${timeoutSeconds}];`;

  if (area.kind === 'bbox') {
    const { minLat, minLon, maxLat, maxLon } = area.bbox;
    const bboxClause = `(${minLat},${minLon},${maxLat},${maxLon})`;
    return [
      header,
      '(',
      `  way["building"]${bboxClause};`,
      `  relation["building"]["type"="multipolygon"]${bboxClause};`,
      ');',
      'out geom;',
    ].join('\n');
  }

  assertSafeAreaName(area.areaName);
  return [
    header,
    `area["name"="${area.areaName}"]->.searchArea;`,
    '(',
    '  way["building"](area.searchArea);',
    '  relation["building"]["type"="multipolygon"](area.searchArea);',
    ');',
    'out geom;',
  ].join('\n');
}
