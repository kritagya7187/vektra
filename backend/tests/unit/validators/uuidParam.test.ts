import { describe, expect, it } from 'vitest';
import { uuidParamSchema } from '../../../src/validators/uuidParam';

describe('uuidParamSchema', () => {
  it('accepts { id: <uuid> }', () => {
    expect(uuidParamSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111' }).success).toBe(
      true,
    );
  });

  it('rejects a non-UUID id, with a params-scoped path', () => {
    const result = uuidParamSchema.safeParse({ id: 'export' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['id']);
    }
  });
});
