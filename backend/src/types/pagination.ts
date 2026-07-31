/**
 * Response-side pagination metadata — distinct from
 * validators/pagination.ts's `Pagination` type, which is the VALIDATED
 * REQUEST input shape ({limit, offset} parsed from query params). This
 * is what a paginated list response's meta envelope reports back: the
 * same limit/offset that was applied, plus totals the client can't
 * compute itself. Two different concepts that happen to share a name —
 * not a duplicate of each other.
 */
export interface PaginationMeta {
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
  readonly hasMore: boolean;
}
