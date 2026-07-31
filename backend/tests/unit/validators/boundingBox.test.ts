import { describe, expect, it } from 'vitest';
import { bboxSchema } from '../../../src/validators/boundingBox';

describe('bboxSchema', () => {
  it('parses a well-formed "minLon,minLat,maxLon,maxLat" string', () => {
    const result = bboxSchema.safeParse('72.8,18.9,72.9,19.0');
    expect(result).toMatchObject({
      success: true,
      data: { minLon: 72.8, minLat: 18.9, maxLon: 72.9, maxLat: 19.0 },
    });
  });

  it('fails fast with exactly one issue on the wrong part count (not a cascade of confusing errors)', () => {
    const result = bboxSchema.safeParse('72.8,18.9,72.9');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.message).toMatch(/exactly 4/);
    }
  });

  it('rejects non-numeric parts', () => {
    const result = bboxSchema.safeParse('a,b,c,d');
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range longitude', () => {
    const result = bboxSchema.safeParse('-200,18.9,72.9,19.0');
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range latitude', () => {
    const result = bboxSchema.safeParse('72.8,-95,72.9,19.0');
    expect(result.success).toBe(false);
  });

  it('rejects minLon >= maxLon', () => {
    const result = bboxSchema.safeParse('72.9,18.9,72.8,19.0');
    expect(result.success).toBe(false);
  });

  it('rejects minLat >= maxLat', () => {
    const result = bboxSchema.safeParse('72.8,19.0,72.9,18.9');
    expect(result.success).toBe(false);
  });
});
