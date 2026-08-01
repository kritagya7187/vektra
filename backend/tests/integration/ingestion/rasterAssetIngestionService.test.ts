import { describe, expect, it } from 'vitest';
import { database } from '../../../src/database';
import { ConflictError } from '../../../src/errors';
import { RasterAssetIngestionService } from '../../../src/ingestion/remoteSensing/RasterAssetIngestionService';
import type {
  RasterDatasetClient,
  RasterDatasetMetadata,
} from '../../../src/ingestion/remoteSensing/types';
import { environmentalRasterAssetRepository } from '../../../src/repositories';
import type { EnvironmentalRasterAssetRepository } from '../../../src/types';

/**
 * Real database, REAL repository/service/transaction layers — only the
 * HTTP-fetching client is stubbed, same discipline as
 * osmIngestionService.test.ts. A genuine end-to-end run against a real
 * local stand-in HTTP server (standing in for Sentinel-2/Landsat/
 * WorldCover/SRTM, none of which this environment has credentials for)
 * was performed once, manually — see the engineering review.
 */
function fakeRasterClient(scenes: readonly RasterDatasetMetadata[]): RasterDatasetClient {
  return { sourceCode: 'sentinel2_l2a', fetchMetadata: () => Promise.resolve(scenes) };
}

const SCENE_A: RasterDatasetMetadata = {
  sourceProductIdentifier: 'S2A_MSIL2A_20250115T053641',
  acquisitionDate: new Date('2025-01-15T05:36:41Z'),
  crs: 'EPSG:32643',
  resolutionM: 10,
  storageLocation: 'https://example.test/S2A_MSIL2A_20250115T053641.tif',
  spatialExtent: {
    type: 'Polygon',
    coordinates: [
      [
        [72.8, 18.9],
        [72.9, 18.9],
        [72.9, 19.0],
        [72.8, 19.0],
        [72.8, 18.9],
      ],
    ],
  },
  checksum: 'checksum-a',
};

const SCENE_B: RasterDatasetMetadata = {
  ...SCENE_A,
  sourceProductIdentifier: 'S2A_MSIL2A_20250122T053641',
  acquisitionDate: new Date('2025-01-22T05:36:41Z'),
  storageLocation: 'https://example.test/S2A_MSIL2A_20250122T053641.tif',
  checksum: 'checksum-b',
};

const query = { bbox: { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 } };

describe('RasterAssetIngestionService (real DB, stubbed raster client)', () => {
  it('registers one EnvironmentalRasterAsset AND one DataProvenanceRecord PER scene', async () => {
    const service = new RasterAssetIngestionService(fakeRasterClient([SCENE_A, SCENE_B]));

    const summary = await service.ingest(query);

    expect(summary.sourceCode).toBe('sentinel2_l2a');
    expect(summary.totalDiscovered).toBe(2);
    expect(summary.registeredCount).toBe(2);
    expect(summary.skippedCount).toBe(0);

    const assets = await environmentalRasterAssetRepository.list({ limit: 10 });
    const assetA = assets.find((a) => a.storageLocation === SCENE_A.storageLocation);
    const assetB = assets.find((a) => a.storageLocation === SCENE_B.storageLocation);
    expect(assetA).toBeDefined();
    expect(assetB).toBeDefined();
    // Each scene got its OWN provenance record, not one shared record.
    expect(assetA?.provenanceId).not.toBe(assetB?.provenanceId);

    const provenanceRows = await database.query<{
      source_code: string;
      license: string;
      source_product_identifier: string;
    }>(
      'SELECT source_code, license, source_product_identifier FROM data_provenance_record WHERE provenance_id = ANY($1)',
      [[assetA?.provenanceId, assetB?.provenanceId]],
    );
    expect(provenanceRows.rows).toHaveLength(2);
    expect(provenanceRows.rows.every((r) => r.source_code === 'sentinel2_l2a')).toBe(true);
    expect(provenanceRows.rows.every((r) => r.license.includes('Copernicus'))).toBe(true);
  });

  it('re-ingesting the same scene creates a NEW provenance+asset pair (versioned snapshot, same as OSM)', async () => {
    const service = new RasterAssetIngestionService(fakeRasterClient([SCENE_A]));

    const first = await service.ingest(query);
    const second = await service.ingest(query);

    expect(first.registeredCount).toBe(1);
    expect(second.registeredCount).toBe(1);

    const assets = (await environmentalRasterAssetRepository.list({ limit: 50 })).filter(
      (a) => a.storageLocation === SCENE_A.storageLocation,
    );
    expect(assets).toHaveLength(2);
    expect(assets[0]?.provenanceId).not.toBe(assets[1]?.provenanceId);
  });

  it('isolates a per-scene registration failure via SAVEPOINT: the failing scene leaves NO orphaned provenance record, other scenes still commit', async () => {
    let callCount = 0;
    const flakyAssetRepository: EnvironmentalRasterAssetRepository = {
      findById: environmentalRasterAssetRepository.findById.bind(
        environmentalRasterAssetRepository,
      ),
      findByProvenanceId: environmentalRasterAssetRepository.findByProvenanceId.bind(
        environmentalRasterAssetRepository,
      ),
      list: environmentalRasterAssetRepository.list.bind(environmentalRasterAssetRepository),
      create: async (input, executor) => {
        callCount += 1;
        if (input.storageLocation === SCENE_B.storageLocation) {
          throw new ConflictError('simulated per-scene failure');
        }
        return environmentalRasterAssetRepository.create(input, executor);
      },
    };

    const service = new RasterAssetIngestionService(fakeRasterClient([SCENE_A, SCENE_B]), {
      environmentalRasterAssetRepository: flakyAssetRepository,
    });

    const beforeProvenanceCount = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM data_provenance_record',
    );

    const summary = await service.ingest(query);

    expect(callCount).toBe(2);
    expect(summary.registeredCount).toBe(1);
    expect(summary.skipped).toEqual([
      {
        sourceProductIdentifier: SCENE_B.sourceProductIdentifier,
        reason: 'simulated per-scene failure',
      },
    ]);

    // The atomic pair means scene B's DataProvenanceRecord (created
    // BEFORE the asset insert failed, inside the same SAVEPOINT) rolled
    // back too — never left orphaned.
    const afterProvenanceCount = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM data_provenance_record',
    );
    expect(Number(afterProvenanceCount.rows[0]?.count)).toBe(
      Number(beforeProvenanceCount.rows[0]?.count) + 1,
    );

    const assets = await environmentalRasterAssetRepository.list({ limit: 50 });
    expect(assets.some((a) => a.storageLocation === SCENE_A.storageLocation)).toBe(true);
    expect(assets.some((a) => a.storageLocation === SCENE_B.storageLocation)).toBe(false);
  });
});
