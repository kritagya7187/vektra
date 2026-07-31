/**
 * Fields that must never appear in plaintext in any log line, regardless
 * of which subsystem or future call site produces it.
 *
 * EDD Section 30: API/backend logs must be "sufficient for debugging,
 * excluding any sensitive credentials."
 *
 * The request-completion log line this subsystem emits never includes
 * headers or a body in the first place (see middleware/requestContext.ts),
 * so these paths are defense-in-depth: a safety net for any log call a
 * later subsystem adds that happens to include a headers or payload
 * object, not something this subsystem's own code currently triggers.
 */
export const SENSITIVE_LOG_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'password',
  'token',
  'secret',
  '*.password',
  '*.token',
  '*.secret',
];

export const REDACTION_CENSOR = '[REDACTED]';
