import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTION_CENSOR, SENSITIVE_LOG_PATHS } from '../../../src/logging/redaction';

/**
 * Exercises the redaction config the way Pino actually applies it
 * (constructing a real Pino instance with a capturing stream), not just
 * asserting on the plain arrays — proves the paths actually redact.
 */
function loggerToCapture(): { logger: pino.Logger; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = {
    write: (chunk: string): boolean => {
      chunks.push(chunk);
      return true;
    },
  };
  const logger = pino(
    { redact: { paths: SENSITIVE_LOG_PATHS, censor: REDACTION_CENSOR } },
    stream as unknown as pino.DestinationStream,
  );
  return { logger, lines: () => chunks.map((c) => JSON.parse(c) as Record<string, unknown>) };
}

describe('logging redaction', () => {
  it('redacts a top-level password field', () => {
    const { logger, lines } = loggerToCapture();
    logger.info({ password: 'hunter2' }, 'msg');
    expect((lines()[0] as Record<string, unknown>).password).toBe(REDACTION_CENSOR);
  });

  it('redacts a nested secret field via the wildcard path', () => {
    const { logger, lines } = loggerToCapture();
    logger.info({ credentials: { secret: 'top-secret' } }, 'msg');
    const line = lines()[0] as { credentials: { secret: string } };
    expect(line.credentials.secret).toBe(REDACTION_CENSOR);
  });

  it('redacts req.headers.authorization', () => {
    const { logger, lines } = loggerToCapture();
    logger.info({ req: { headers: { authorization: 'Bearer abc' } } }, 'msg');
    const line = lines()[0] as { req: { headers: { authorization: string } } };
    expect(line.req.headers.authorization).toBe(REDACTION_CENSOR);
  });

  it('does not redact unrelated fields', () => {
    const { logger, lines } = loggerToCapture();
    logger.info({ requestId: 'abc-123' }, 'msg');
    expect((lines()[0] as Record<string, unknown>).requestId).toBe('abc-123');
  });
});
