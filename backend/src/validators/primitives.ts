import { z, type ZodTypeAny } from 'zod';

/**
 * Shared, reusable validation primitives. Pure Zod — no Express
 * dependency anywhere in this file, so every one of these is testable
 * and composable without an HTTP request in sight.
 */

export const uuidSchema = z.string().uuid('must be a valid UUID');

interface NumericBounds {
  readonly min?: number;
  readonly max?: number;
}

export function integerSchema(bounds: NumericBounds = {}) {
  let schema = z.coerce.number().int('must be an integer');
  if (bounds.min !== undefined) {
    schema = schema.min(bounds.min, `must be at least ${bounds.min}`);
  }
  if (bounds.max !== undefined) {
    schema = schema.max(bounds.max, `must be at most ${bounds.max}`);
  }
  return schema;
}

export function numericSchema(bounds: NumericBounds = {}) {
  let schema = z.coerce.number();
  if (bounds.min !== undefined) {
    schema = schema.min(bounds.min, `must be at least ${bounds.min}`);
  }
  if (bounds.max !== undefined) {
    schema = schema.max(bounds.max, `must be at most ${bounds.max}`);
  }
  return schema;
}

/**
 * Deliberately NOT z.coerce.boolean(): JavaScript's Boolean(x) coerces
 * any non-empty string to true, so naive coercion would treat the
 * literal query string "false" as true. Only the exact strings
 * "true"/"false" are accepted.
 */
export const booleanQuerySchema = z
  .enum(['true', 'false'], {
    errorMap: () => ({ message: 'must be "true" or "false"' }),
  })
  .transform((value) => value === 'true');

/**
 * Transforms to a real Date, not a re-validated string — per "downstream
 * layers never need to re-validate or cast."
 */
export const isoTimestampSchema = z
  .string()
  .datetime({ offset: true, message: 'must be an ISO-8601 timestamp' })
  .transform((value) => new Date(value));

export function createEnumSchema<T extends [string, ...string[]]>(values: T) {
  return z.enum(values, {
    errorMap: () => ({ message: `must be one of: ${values.join(', ')}` }),
  });
}

export function nonEmptyStringSchema(minLength = 1) {
  return z.string().trim().min(minLength, 'must not be empty');
}

/**
 * HTTP query strings have no native array type; comma-separated values
 * are the standard REST convention (e.g. ?ids=a,b,c).
 */
export function csvArraySchema<T extends ZodTypeAny>(itemSchema: T) {
  return z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .pipe(z.array(itemSchema));
}

function normalizeEmptyQueryValue(value: unknown): unknown {
  return value === '' ? undefined : value;
}

/**
 * A query param that is entirely omitted parses to undefined, but
 * `?param=` (present, empty) parses to "" — without this normalization,
 * `.default()` never applies to an explicitly-empty param, and
 * z.coerce.number() on "" silently coerces to 0 rather than failing.
 */
export function optionalQueryParam<T extends ZodTypeAny>(schema: T) {
  return z.preprocess(normalizeEmptyQueryValue, schema.optional());
}
