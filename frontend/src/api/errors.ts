export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly details: unknown;
}
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
