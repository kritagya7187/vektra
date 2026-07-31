import type { Logger } from 'pino';
import type {
  ExtractedOsmAttributes,
  IngestionCandidate,
  OsmElement,
  OsmLatLon,
  OverpassResponse,
  Ring,
} from '../types';

/**
 * Pure — no I/O. Extracts only the 8 documented attributes (this
 * subsystem's brief, item 3) from each element's tags; anything else
 * (amenity, shop, addr-adjacent-but-undocumented tags, etc.) is never
 * read. Elements without a `building` tag or without usable geometry
 * are dropped here (logged at debug — not "skipped features" in the
 * summary sense, since they were never valid ingestion candidates to
 * begin with; the query itself should never return these, but real
 * Overpass responses are not assumed trustworthy).
 */

function ringFromLatLon(points: readonly OsmLatLon[]): Ring {
  return points.map((p) => [p.lon, p.lat] as const);
}

function extractAttributes(tags: Readonly<Record<string, string>> = {}): ExtractedOsmAttributes {
  const addressTags: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (key.startsWith('addr:')) {
      addressTags[key] = value;
    }
  }
  return {
    building: tags.building ?? null,
    buildingLevels: tags['building:levels'] ?? null,
    height: tags.height ?? null,
    roofShape: tags['roof:shape'] ?? null,
    roofMaterial: tags['roof:material'] ?? null,
    buildingMaterial: tags['building:material'] ?? null,
    name: tags.name ?? null,
    addressTags,
  };
}

/**
 * way -> a single outer ring. relation -> the first "outer" member's
 * ring plus every "inner" member's ring (holes). Deliberately limited
 * to the first outer member: a true multi-part multipolygon (more than
 * one disjoint outer ring under one relation) would need ring-assembly
 * logic beyond this pass's scope — documented limitation, not silently
 * mishandled (logged when it occurs).
 */
function extractRings(element: OsmElement, logger: Logger): readonly Ring[] {
  if (element.type === 'way') {
    if (!element.geometry || element.geometry.length === 0) {
      return [];
    }
    return [ringFromLatLon(element.geometry)];
  }

  const members = element.members ?? [];
  const outerMembers = members.filter((m) => m.role === 'outer' && m.geometry);
  const innerMembers = members.filter((m) => m.role === 'inner' && m.geometry);

  if (outerMembers.length === 0) {
    return [];
  }
  if (outerMembers.length > 1) {
    logger.warn(
      { osmId: element.id, outerCount: outerMembers.length },
      'multipolygon relation has more than one outer member; using only the first (documented limitation)',
    );
  }

  const outerRing = ringFromLatLon(outerMembers[0].geometry!);
  const innerRings = innerMembers.map((m) => ringFromLatLon(m.geometry!));
  return [outerRing, ...innerRings];
}

export function parseOverpassResponse(
  response: OverpassResponse,
  logger: Logger,
): readonly IngestionCandidate[] {
  const candidates: IngestionCandidate[] = [];

  for (const element of response.elements) {
    if (!element.tags?.building) {
      logger.debug(
        { osmId: element.id, osmType: element.type },
        'element has no building tag, dropped',
      );
      continue;
    }

    const rings = extractRings(element, logger);
    if (rings.length === 0) {
      logger.debug(
        { osmId: element.id, osmType: element.type },
        'element has no usable geometry, dropped',
      );
      continue;
    }

    candidates.push({
      osmId: element.id,
      osmType: element.type,
      attributes: extractAttributes(element.tags),
      rings,
    });
  }

  return candidates;
}

/** OSM height values are commonly "12", "12.5", or "12 m" — parses the leading numeric portion only. */
export function parseHeightMeters(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const match = /^(\d+(\.\d+)?)/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseBuildingLevels(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}
