/**
 * Shared HTTP-status → log-level mapping. Extracted from
 * requestContext.ts (Logging subsystem) so errorHandler.ts (this
 * subsystem) doesn't reimplement the same rule — "no duplicated error
 * handling logic."
 */
export type LogLevelForStatus = 'info' | 'warn' | 'error';

export function resolveLogLevelForStatus(statusCode: number): LogLevelForStatus {
  if (statusCode >= 500) {
    return 'error';
  }
  if (statusCode >= 400) {
    return 'warn';
  }
  return 'info';
}
