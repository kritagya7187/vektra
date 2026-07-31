import { describe, expect, it } from 'vitest';
import { dateRangeSchema } from '../../../src/validators/dateRange';

describe('dateRangeSchema', () => {
  it('accepts an omitted from/to (both optional)', () => {
    expect(dateRangeSchema.safeParse({}).success).toBe(true);
  });

  it('accepts from <= to', () => {
    const result = dateRangeSchema.safeParse({
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects from > to', () => {
    const result = dateRangeSchema.safeParse({
      from: '2026-02-01T00:00:00Z',
      to: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});
