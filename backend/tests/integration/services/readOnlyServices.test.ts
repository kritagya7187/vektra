import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/errors';
import {
  buildingService,
  dataProvenanceService,
  dataSourceService,
  environmentalRasterAssetService,
  meteorologicalObservationService,
} from '../../../src/services';
import {
  createBuilding,
  createDataProvenanceRecord,
  createEnvironmentalRasterAsset,
} from '../../helpers/fixtures';

/**
 * The five structurally read-only services (Subsystem 9: no
 * INSERT/UPDATE grant exists below any of them) share the identical
 * existence-validation shape — getById throws NotFoundError, list()
 * proxies the repository. Grouped in one file since there is no
 * per-service business-rule variation to justify five separate files.
 */

describe('DataSourceService', () => {
  it('getById returns a seeded row', async () => {
    const ds = await dataSourceService.getById('osm_overpass');
    expect(ds.sourceCode).toBe('osm_overpass');
  });
  it('getById throws NotFoundError for an unknown code', async () => {
    await expect(dataSourceService.getById('nope')).rejects.toThrow(NotFoundError);
  });
});

describe('DataProvenanceService', () => {
  it('getById returns a fixture row', async () => {
    const fixture = await createDataProvenanceRecord();
    const record = await dataProvenanceService.getById(fixture.provenanceId);
    expect(record.provenanceId).toBe(fixture.provenanceId);
  });
  it('getById throws NotFoundError for an unknown id', async () => {
    await expect(
      dataProvenanceService.getById('11111111-1111-1111-1111-111111111111'),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('BuildingService', () => {
  it('getById returns a fixture row with real geometry', async () => {
    const fixture = await createBuilding();
    const building = await buildingService.getById(fixture.buildingId);
    expect(building.buildingId).toBe(fixture.buildingId);
    expect(building.geomWgs84.type).toBe('MultiPolygon');
  });
  it('getById throws NotFoundError for an unknown id', async () => {
    await expect(buildingService.getById('11111111-1111-1111-1111-111111111111')).rejects.toThrow(
      NotFoundError,
    );
  });
  it('list returns fixture rows', async () => {
    await createBuilding();
    await createBuilding();
    expect(await buildingService.list()).toHaveLength(2);
  });
});

describe('EnvironmentalRasterAssetService', () => {
  it('getById returns a fixture row', async () => {
    const fixture = await createEnvironmentalRasterAsset();
    const asset = await environmentalRasterAssetService.getById(fixture.rasterAssetId);
    expect(asset.rasterAssetId).toBe(fixture.rasterAssetId);
  });
  it('getById throws NotFoundError for an unknown id', async () => {
    await expect(
      environmentalRasterAssetService.getById('11111111-1111-1111-1111-111111111111'),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('MeteorologicalObservationService', () => {
  it('list returns an empty array when no observations exist', async () => {
    expect(await meteorologicalObservationService.list()).toEqual([]);
  });
  it('getById throws NotFoundError for an unknown id', async () => {
    await expect(
      meteorologicalObservationService.getById('11111111-1111-1111-1111-111111111111'),
    ).rejects.toThrow(NotFoundError);
  });
});
