/**
 * Mirrors backend/src/types/apiResponse.ts's ApiErrorResponse shape
 * exactly (middleware/errorHandler.ts is the backend's single source of
 * truth for this envelope) — `code` is the stable contract this client
 * switches on, never the raw HTTP status alone (design review §13).
 */
export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly details: unknown;
}

/**
 * The backend's real, closed error taxonomy (errors/*.ts) plus one
 * client-only addition, NETWORK_ERROR, for when fetch() itself never
 * reached the server (offline, DNS failure, CORS rejection, etc.) — the
 * backend can never produce this code, since it requires a request to
 * have arrived. Design review §13 requires distinguishing this case from
 * every real HTTP response.
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DATABASE_ERROR'
  | 'INTERNAL_SERVER_ERROR'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(options: {
    code: ApiErrorCode;
    message: string;
    status: number | null;
    requestId?: string | null;
    details?: unknown;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.details = options.details ?? null;
  }
}
