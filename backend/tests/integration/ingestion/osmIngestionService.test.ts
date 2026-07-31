import { describe, expect, it } from 'vitest';
import { database } from '../../../src/database';
import { ConflictError } from '../../../src/errors';
import { OsmIngestionService } from '../../../src/ingestion/OsmIngestionService';
import type { OverpassClient } from '../../../src/ingestion/osm/OverpassClient';
import type { OsmElement } from '../../../src/ingestion/types';
import { buildingRepository } from '../../../src/repositories';
import type { BuildingRepository } from '../../../src/types';

/**
 * Real database (the shared disposable test container, Testing
 * subsystem), REAL repository/service/transaction layers — only the
 * Overpass HTTP call is stubbed (a fake OverpassClient), so these tests
 * are deterministic and don't depend on network access or the real
 * upstream API. A genuine end-to-end run against the real Overpass API
 * was performed once, manually, during this subsystem's own
 * verification — see the engineering review for that result.
 */
function fakeOverpassClient(elements: readonly OsmElement[]): OverpassClient {
  return { fetchElements: () => Promise.resolve(elements) } as unknown as OverpassClient;
}

const VALID_WAY_A: OsmElement = {
  type: 'way',
  id: 900001,
  tags: { building: 'house', height: '12', 'building:levels': '3', name: 'Building A' },
  geometry: [
    { lat: 18.9, lon: 72.8 },
    { lat: 18.9, lon: 72.801 },
    { lat: 18.901, lon: 72.801 },
    { lat: 18.901, lon: 72.8 },
  ],
};

const VALID_WAY_B: OsmElement = {
  type: 'way',
  id: 900002,
  tags: { building: 'apartments' },
  geometry: [
    { lat: 18.91, lon: 72.81 },
    { lat: 18.91, lon: 72.811 },
    { lat: 18.911, lon: 72.811 },
    { lat: 18.911, lon: 72.81 },
  ],
};

const BAD_GEOMETRY_WAY: OsmElement = {
  type: 'way',
  id: 900003,
  tags: { building: 'yes' },
  // 4 points, but all identical — passes the point-count check, then
  // correctly rejected as degenerate (zero area). geometry.test.ts
  // covers the "too few points" case separately.
  geometry: [
    { lat: 18.92, lon: 72.82 },
    { lat: 18.92, lon: 72.82 },
    { lat: 18.92, lon: 72.82 },
    { lat: 18.92, lon: 72.82 },
  ],
};

const bbox = {
  kind: 'bbox' as const,
  bbox: { minLon: 72.8, minLat: 18.9, maxLon: 72.82, maxLat: 18.92 },
};

describe('OsmIngestionService (real DB, stubbed Overpass client)', () => {
  it('creates a DataProvenanceRecord and inserts valid buildings through the repository layer', async () => {
    const service = new OsmIngestionService({
      overpassClient: fakeOverpassClient([VALID_WAY_A, VALID_WAY_B]),
    });

    const summary = await service.ingest(bbox);

    expect(summary.insertedCount).toBe(2);
    expect(summary.skippedCount).toBe(0);
    expect(summary.totalFeaturesReturned).toBe(2);

    // Independently re-read via the real repository — not the service's
    // own return value — to prove it actually persisted.
    const buildingA = (await buildingRepository.list({ limit: 10 })).find(
      (b) => b.osmId === 900001,
    );
    expect(buildingA?.buildingTagType).toBe('house');
    expect(buildingA?.heightM).toBe(12);
    expect(buildingA?.buildingLevels).toBe(3);
    expect(buildingA?.name).toBe('Building A');
    expect(buildingA?.provenanceId).toBe(summary.provenanceId);
    expect(buildingA?.geomWgs84.type).toBe('MultiPolygon');

    const provenance = await database.query<{ source_code: string; license: string }>(
      'SELECT source_code, license FROM data_provenance_record WHERE provenance_id = $1',
      [summary.provenanceId],
    );
    expect(provenance.rows[0]?.source_code).toBe('osm_overpass');
    expect(provenance.rows[0]?.license).toContain('ODbL');
  });

  it('skips a structurally invalid geometry without aborting the rest of the run', async () => {
    const service = new OsmIngestionService({
      overpassClient: fakeOverpassClient([VALID_WAY_A, BAD_GEOMETRY_WAY]),
    });

    const summary = await service.ingest(bbox);

    expect(summary.insertedCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.skipped[0]?.osmId).toBe(900003);
    expect(summary.skipped[0]?.reason).toContain('degenerate');
  });

  it('deduplicates a repeated element within one run (same osmId + osmType)', async () => {
    const service = new OsmIngestionService({
      overpassClient: fakeOverpassClient([VALID_WAY_A, VALID_WAY_A]),
    });

    const summary = await service.ingest(bbox);

    expect(summary.insertedCount).toBe(1);
    const matches = (await buildingRepository.list({ limit: 10 })).filter(
      (b) => b.osmId === 900001,
    );
    expect(matches).toHaveLength(1);
  });

  it('isolates a per-row insert failure via SAVEPOINT — the provenance record and other buildings still commit', async () => {
    // Re-ingesting the exact same osmId under a DIFFERENT provenance
    // batch is allowed by the schema (uq_building_osm_snapshot includes
    // provenance_id) — so to force a genuine per-row DB-level failure
    // deterministically, insert building A once first, then run an
    // ingestion that includes an osmId/provenance combination colliding
    // with itself twice in a way the in-memory dedup cannot catch: we
    // simulate this by using a fake buildingRepository that fails on a
    // specific osmId, proving the OTHER rows still commit.
    // NOTE: spreading a class instance ({...buildingRepository}) would
    // only copy its own enumerable properties, not prototype methods —
    // findById/list live on the prototype, so a spread-based fake would
    // silently have them as undefined. Binding explicitly instead.
    let callCount = 0;
    const flakyBuildingRepository: BuildingRepository = {
      findById: buildingRepository.findById.bind(buildingRepository),
      list: buildingRepository.list.bind(buildingRepository),
      listByProvenanceId: buildingRepository.listByProvenanceId.bind(buildingRepository),
      create: async (input, executor) => {
        callCount += 1;
        if (input.osmId === 900002) {
          throw new ConflictError('simulated per-row failure');
        }
        return buildingRepository.create(input, executor);
      },
    };

    const service = new OsmIngestionService({
      overpassClient: fakeOverpassClient([VALID_WAY_A, VALID_WAY_B]),
      buildingRepository: flakyBuildingRepository,
    });

    const summary = await service.ingest(bbox);

    expect(callCount).toBe(2);
    expect(summary.insertedCount).toBe(1);
    expect(summary.skipped).toEqual([
      { osmId: 900002, osmType: 'way', reason: 'simulated per-row failure' },
    ]);

    const persisted = await buildingRepository.list({ limit: 10 });
    expect(persisted.some((b) => b.osmId === 900001)).toBe(true);
    expect(persisted.some((b) => b.osmId === 900002)).toBe(false);

    const provenance = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM data_provenance_record WHERE provenance_id = $1',
      [summary.provenanceId],
    );
    expect(provenance.rows[0]?.count).toBe('1');
  });

  it('rolls back the ENTIRE transaction (including the provenance record) on a genuine upstream failure', async () => {
    const failingProvenanceRepository = {
      create: () => Promise.reject(new Error('simulated infrastructure failure')),
      findById: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      findLatestBySourceCode: () => Promise.resolve(null),
    };

    const service = new OsmIngestionService({
      overpassClient: fakeOverpassClient([VALID_WAY_A]),
      dataProvenanceRecordRepository: failingProvenanceRepository,
    });

    const before = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM data_provenance_record',
    );

    await expect(service.ingest(bbox)).rejects.toThrow();

    const after = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM data_provenance_record',
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);

    const buildings = await buildingRepository.list({ limit: 10 });
    expect(buildings.some((b) => b.osmId === 900001)).toBe(false);
  });
});
