import type { BoundingBox } from '../validators';
import type { OsmType } from '../types';
import type { GeoJsonMultiPolygon } from '../types/geometry';

/** Overpass's `out geom;` node shape — {lat, lon}, not GeoJSON's [lon, lat]. */
export interface OsmLatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface OsmWayElement {
  readonly type: 'way';
  readonly id: number;
  readonly tags?: Readonly<Record<string, string>>;
  readonly geometry?: readonly OsmLatLon[];
}

export interface OsmRelationMember {
  readonly type: string;
  readonly ref: number;
  readonly role: string;
  readonly geometry?: readonly OsmLatLon[];
}

export interface OsmRelationElement {
  readonly type: 'relation';
  readonly id: number;
  readonly tags?: Readonly<Record<string, string>>;
  readonly members?: readonly OsmRelationMember[];
}

export type OsmElement = OsmWayElement | OsmRelationElement;

export interface OverpassResponse {
  readonly elements: readonly OsmElement[];
}

/**
 * Bounding box or named area — never a hardcoded city name anywhere in
 * the query builder itself; the caller always supplies one of these.
 */
export type IngestionArea =
  | { readonly kind: 'bbox'; readonly bbox: BoundingBox }
  | { readonly kind: 'namedArea'; readonly areaName: string };

/**
 * The 8 documented attributes (this subsystem's brief, item 3),
 * extracted verbatim from OSM tags before any schema-fit mapping.
 * roofShape/roofMaterial/buildingMaterial/addressTags have no column in
 * the existing `building` table and are never persisted — see
 * OsmIngestionService's own note on why they're still extracted here.
 */
export interface ExtractedOsmAttributes {
  readonly building: string | null;
  readonly buildingLevels: string | null;
  readonly height: string | null;
  readonly roofShape: string | null;
  readonly roofMaterial: string | null;
  readonly buildingMaterial: string | null;
  readonly name: string | null;
  readonly addressTags: Readonly<Record<string, string>>;
}

/** One ring is an ordered list of [lon, lat] pairs (GeoJSON coordinate order). */
export type Ring = readonly (readonly [number, number])[];

export interface IngestionCandidate {
  readonly osmId: number;
  readonly osmType: OsmType;
  readonly attributes: ExtractedOsmAttributes;
  /** [outerRing, ...innerRings] — inner rings only ever populated for multipolygon relations. */
  readonly rings: readonly Ring[];
}

export type GeometryOutcome =
  | { readonly status: 'valid'; readonly geoJson: GeoJsonMultiPolygon }
  | { readonly status: 'rejected'; readonly reason: string };

export interface SkippedFeature {
  readonly osmId: number;
  readonly osmType: OsmType;
  readonly reason: string;
}

export interface IngestionSummary {
  readonly provenanceId: string;
  readonly totalFeaturesReturned: number;
  readonly insertedCount: number;
  readonly skippedCount: number;
  readonly skipped: readonly SkippedFeature[];
  readonly durationMs: number;
}
