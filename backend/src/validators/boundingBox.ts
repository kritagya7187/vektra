import { z } from 'zod';

const BBOX_PART_COUNT = 4;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;

export interface BoundingBox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

/**
 * EDD Section 33 explicitly names "bounding-box parameters if ever
 * exposed" as requiring server-side validation. Parses a query string
 * like "72.8,18.9,72.9,19.0" into a typed BoundingBox, checking
 * structure (exactly 4 numeric values), then real geographic validity
 * (longitude in [-180,180], latitude in [-90,90], min < max) — coordinate
 * validity, not a business rule.
 *
 * All checks live inside one .transform(), each returning z.NEVER on the
 * first failure, rather than a chain of independent .refine() calls.
 * Zod does not short-circuit a .refine() chain when an earlier
 * .transform() step already reported an issue — every subsequent .refine()
 * still runs, which produced a genuinely confusing result under testing:
 * a bbox with the wrong number of parts (structurally malformed, not
 * even parsed to numbers) came back with 5 error messages, including
 * bogus "latitude must be between -90 and 90" checks evaluated against
 * nothing meaningful. These checks are inherently sequential — checking
 * min < max is meaningless before confirming the values are even
 * numeric — so failing fast on the first real problem is the correct
 * behavior here, not a limitation.
 */
export const bboxSchema = z.string().transform((value, ctx) => {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== BBOX_PART_COUNT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'bbox must have exactly 4 comma-separated values: minLon,minLat,maxLon,maxLat',
    });
    return z.NEVER;
  }

  const numbers = parts.map(Number);
  if (numbers.some((n) => Number.isNaN(n))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox values must be numeric' });
    return z.NEVER;
  }

  const [minLon, minLat, maxLon, maxLat] = numbers as [number, number, number, number];

  if (minLon < MIN_LONGITUDE || maxLon > MAX_LONGITUDE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `longitude must be between ${MIN_LONGITUDE} and ${MAX_LONGITUDE}`,
    });
    return z.NEVER;
  }
  if (minLat < MIN_LATITUDE || maxLat > MAX_LATITUDE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `latitude must be between ${MIN_LATITUDE} and ${MAX_LATITUDE}`,
    });
    return z.NEVER;
  }
  if (minLon >= maxLon) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'minLon must be less than maxLon' });
    return z.NEVER;
  }
  if (minLat >= maxLat) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'minLat must be less than maxLat' });
    return z.NEVER;
  }

  return { minLon, minLat, maxLon, maxLat };
});
