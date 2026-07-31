import { describe, expect, it } from 'vitest';
import { paginationSchema } from '../../../src/validators/pagination';

describe('paginationSchema', () => {
  it('applies default limit=50, offset=0 when both are omitted', () => {
    const result = paginationSchema.safeParse({});
    expect(result).toMatchObject({ success: true, data: { limit: 50, offset: 0 } });
  });

  it('coerces string query values to numbers', () => {
    const result = paginationSchema.safeParse({ limit: '10', offset: '20' });
    expect(result).toMatchObject({ success: true, data: { limit: 10, offset: 20 } });
  });

  it('rejects a limit above MAX_LIMIT (200)', () => {
    expect(paginationSchema.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('rejects a negative offset', () => {
    expect(paginationSchema.safeParse({ offset: '-1' }).success).toBe(false);
  });

  it('rejects a limit below 1', () => {
    expect(paginationSchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});
