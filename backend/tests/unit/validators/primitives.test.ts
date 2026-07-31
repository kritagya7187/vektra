import { describe, expect, it } from 'vitest';
import {
  booleanQuerySchema,
  createEnumSchema,
  csvArraySchema,
  integerSchema,
  isoTimestampSchema,
  nonEmptyStringSchema,
  numericSchema,
  optionalQueryParam,
  uuidSchema,
} from '../../../src/validators/primitives';

describe('uuidSchema', () => {
  it('accepts a valid UUID', () => {
    expect(uuidSchema.safeParse('11111111-1111-1111-1111-111111111111').success).toBe(true);
  });
  it('rejects a non-UUID string', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('integerSchema', () => {
  it('coerces a numeric string and enforces bounds', () => {
    const schema = integerSchema({ min: 1, max: 10 });
    expect(schema.safeParse('5').success).toBe(true);
    expect(schema.safeParse('0').success).toBe(false);
    expect(schema.safeParse('11').success).toBe(false);
  });
  it('rejects a non-integer', () => {
    expect(integerSchema().safeParse('1.5').success).toBe(false);
  });
});

describe('numericSchema', () => {
  it('accepts a decimal within bounds', () => {
    expect(numericSchema({ min: 0, max: 1 }).safeParse('0.5').success).toBe(true);
  });
});

describe('booleanQuerySchema', () => {
  it('accepts only the literal strings "true"/"false"', () => {
    expect(booleanQuerySchema.safeParse('true')).toMatchObject({ success: true, data: true });
    expect(booleanQuerySchema.safeParse('false')).toMatchObject({ success: true, data: false });
  });
  it('rejects a truthy-looking but non-literal string (no JS Boolean() coercion)', () => {
    expect(booleanQuerySchema.safeParse('yes').success).toBe(false);
  });
});

describe('isoTimestampSchema', () => {
  it('transforms a valid ISO-8601 offset timestamp into a real Date', () => {
    const result = isoTimestampSchema.safeParse('2026-01-15T00:00:00Z');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeInstanceOf(Date);
    }
  });
  it('rejects a bare date without a time component', () => {
    expect(isoTimestampSchema.safeParse('2026-01-15').success).toBe(false);
  });
});

describe('createEnumSchema', () => {
  const schema = createEnumSchema(['baseline', 'scenario'] as const);
  it('accepts a member of the set', () => {
    expect(schema.safeParse('baseline').success).toBe(true);
  });
  it('rejects a non-member with a message listing valid values', () => {
    const result = schema.safeParse('other');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('baseline');
    }
  });
});

describe('nonEmptyStringSchema', () => {
  it('trims and rejects an all-whitespace string', () => {
    expect(nonEmptyStringSchema().safeParse('   ').success).toBe(false);
  });
  it('accepts a non-empty string', () => {
    expect(nonEmptyStringSchema().safeParse('ok').success).toBe(true);
  });
});

describe('csvArraySchema', () => {
  it('splits, trims, and validates each item', () => {
    const schema = csvArraySchema(uuidSchema);
    const id = '11111111-1111-1111-1111-111111111111';
    const result = schema.safeParse(`${id}, ${id}`);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([id, id]);
    }
  });
});

describe('optionalQueryParam', () => {
  it('treats an omitted value as undefined, not a validation failure', () => {
    const schema = optionalQueryParam(integerSchema());
    expect(schema.safeParse(undefined)).toMatchObject({ success: true, data: undefined });
  });
  it('treats an explicitly empty string the same as omitted, not coerced to 0', () => {
    const schema = optionalQueryParam(integerSchema());
    const result = schema.safeParse('');
    expect(result).toMatchObject({ success: true, data: undefined });
  });
});
