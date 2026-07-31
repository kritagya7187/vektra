import type { GeoJsonMultiPolygon } from '../../types/geometry';
import type { GeometryOutcome, Ring } from '../types';

/**
 * Pure — no PostGIS, no I/O. Handles STRUCTURAL validity only (closed
 * rings, valid coordinates, non-empty geometry) — cheap, deterministic
 * checks that are meaningless to hand to the database. TOPOLOGICAL
 * repair (self-intersections) is deliberately NOT attempted here — it's
 * delegated to PostGIS's ST_MakeValid() at insert time
 * (repositories/BuildingRepository.ts), the correct, standard tool for
 * that specific problem, backed by the existing
 * CHECK (ST_IsValid(geom_wgs84)) constraint as the final "reject
 * unrecoverable geometries" backstop.
 */

const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
/** A closed ring needs at least 3 distinct points plus the closing repeat = 4. */
const MIN_CLOSED_RING_POINTS = 4;

function closeRingIfNeeded(ring: Ring): Ring {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }
  // "Repair invalid polygons when safely possible" — an unclosed ring is
  // the one structural defect that has one unambiguous, safe repair.
  return [...ring, first];
}

function findInvalidCoordinateReason(ring: Ring): string | null {
  for (const [lon, lat] of ring) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return 'contains a non-finite coordinate';
    }
    if (lon < MIN_LONGITUDE || lon > MAX_LONGITUDE) {
      return `longitude ${lon} out of range [${MIN_LONGITUDE}, ${MAX_LONGITUDE}]`;
    }
    if (lat < MIN_LATITUDE || lat > MAX_LATITUDE) {
      return `latitude ${lat} out of range [${MIN_LATITUDE}, ${MAX_LATITUDE}]`;
    }
  }
  return null;
}

function isDegenerate(ring: Ring): boolean {
  const [lon0, lat0] = ring[0];
  return ring.every(([lon, lat]) => lon === lon0 && lat === lat0);
}

function processRing(ring: Ring, label: string): { ring: Ring } | { reason: string } {
  if (ring.length === 0) {
    return { reason: `${label} is empty` };
  }

  const closed = closeRingIfNeeded(ring);
  if (closed.length < MIN_CLOSED_RING_POINTS) {
    return { reason: `${label} has too few distinct points to form a polygon` };
  }

  const coordinateError = findInvalidCoordinateReason(closed);
  if (coordinateError) {
    return { reason: `${label} ${coordinateError}` };
  }

  if (isDegenerate(closed)) {
    return { reason: `${label} is degenerate (all points identical, zero area)` };
  }

  return { ring: closed };
}

/** rings[0] is the outer ring; any further rings are holes (multipolygon relation inner members). */
export function processGeometry(rings: readonly Ring[]): GeometryOutcome {
  if (rings.length === 0) {
    return { status: 'rejected', reason: 'no geometry supplied' };
  }

  const processedRings: Ring[] = [];
  for (const [index, rawRing] of rings.entries()) {
    const label = index === 0 ? 'outer ring' : `inner ring ${index}`;
    const result = processRing(rawRing, label);
    if ('reason' in result) {
      return { status: 'rejected', reason: result.reason };
    }
    processedRings.push(result.ring);
  }

  const geoJson: GeoJsonMultiPolygon = {
    type: 'MultiPolygon',
    coordinates: [processedRings],
  };
  return { status: 'valid', geoJson };
}
