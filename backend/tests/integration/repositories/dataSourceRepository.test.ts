import { describe, expect, it } from 'vitest';
import { dataSourceRepository } from '../../../src/repositories';

describe('DataSourceRepository (real DB, seeded reference data)', () => {
  it('findById returns a seeded row with plain-field mapping', async () => {
    const row = await dataSourceRepository.findById('osm_overpass');
    expect(row).not.toBeNull();
    expect(row?.sourceCode).toBe('osm_overpass');
    expect(row?.displayName).toContain('OpenStreetMap');
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it('findById returns null for an unknown source code', async () => {
    const row = await dataSourceRepository.findById('does-not-exist');
    expect(row).toBeNull();
  });

  it('list returns all 6 seeded data sources', async () => {
    const rows = await dataSourceRepository.list();
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.sourceCode)).toContain('sentinel2_l2a');
  });

  it('list respects limit/offset', async () => {
    const page1 = await dataSourceRepository.list({ limit: 2, offset: 0 });
    const page2 = await dataSourceRepository.list({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1.map((r) => r.sourceCode)).not.toEqual(page2.map((r) => r.sourceCode));
  });
});
