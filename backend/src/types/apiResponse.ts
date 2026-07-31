import type { PaginationMeta } from './pagination';

/**
 * The success half of the response envelope proposed in the
 * architectural review (`{ data, meta? }`) and formalized here. No
 * endpoint returns this yet — Controllers subsystem's job — and
 * GET /health intentionally does NOT use this envelope (Server
 * Bootstrap's documented reasoning: health-check payloads are
 * conventionally their own shape, not the business-data envelope).
 */
export interface ApiSuccessResponse<T> {
  readonly data: T;
  readonly meta?: {
    readonly pagination?: PaginationMeta;
  };
}

/**
 * The error half. Extracted from middleware/errorHandler.ts's
 * previously-private, unexported ErrorResponseBody interface — this is
 * now the single source of truth for that shape; errorHandler.ts imports
 * it rather than declaring its own copy, so the two definitions cannot
 * drift apart.
 */
export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string | null;
    readonly details: unknown;
  };
}
