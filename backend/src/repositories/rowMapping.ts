/**
 * The only two field-level conversions any row mapper in this codebase
 * needs. UUID, TIMESTAMPTZ, and DATE columns already arrive from `pg` as
 * the correct JS type (string, Date, Date respectively) with no
 * conversion required. Geometry/JSON columns are cast to `::json` in the
 * SQL itself, so `pg`'s own JSON type parser (OID 114) already returns a
 * parsed object — no conversion code needed for those either.
 *
 * NUMERIC and BIGINT columns are the one real gap: `pg` returns both as
 * strings by default (to avoid precision loss), not numbers. These two
 * helpers exist so every entity's row mapper handles that identically,
 * rather than five different mappers each writing `Number(row.field)`
 * inline.
 */

export function toNumber(value: unknown): number {
  return Number(value);
}

export function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
