import { AppError } from './AppError';

/**
 * A third-party/upstream API failed or was unreachable after retries
 * (e.g. the Overpass API — OSM Ingestion subsystem). None of the
 * existing six error types fit: this isn't a client input problem
 * (ValidationError), a missing resource (NotFoundError), a write
 * conflict (ConflictError), or this service's own database
 * (DatabaseError) — it's a genuine new failure category this codebase
 * never had a caller for before an outbound HTTP integration existed.
 * 502 (Bad Gateway) is the standard HTTP status for "this service
 * depends on an upstream that failed."
 */
export class ExternalServiceError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'EXTERNAL_SERVICE_ERROR', statusCode: 502, message, cause });
  }
}
