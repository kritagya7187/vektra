import { describe, expect, it } from 'vitest';
import { envSchema } from '../../../src/config/env.schema';

const BASE_VALID_ENV = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_DB: 'vektra',
  POSTGRES_USER: 'vektra_backend_login',
  POSTGRES_PASSWORD: 'x',
};

describe('envSchema', () => {
  it('accepts a minimal valid environment and applies documented defaults', () => {
    const result = envSchema.safeParse(BASE_VALID_ENV);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.BACKEND_PORT).toBe(3000);
      expect(result.data.POSTGRES_PORT).toBe(5432);
      expect(result.data.RATE_LIMIT_ENABLED).toBe(false);
      expect(result.data.LOG_LEVEL).toBe('info');
      expect(result.data.CORS_ALLOWED_ORIGINS).toEqual([]);
    }
  });

  it('rejects a missing POSTGRES_HOST', () => {
    const { POSTGRES_HOST: _drop, ...rest } = BASE_VALID_ENV;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('parses a comma-separated CORS_ALLOWED_ORIGINS into a trimmed array', () => {
    const result = envSchema.safeParse({
      ...BASE_VALID_ENV,
      CORS_ALLOWED_ORIGINS: 'https://a.test, https://b.test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.CORS_ALLOWED_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
    }
  });

  it('requires RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX_REQUESTS when RATE_LIMIT_ENABLED=true, with no hidden default', () => {
    const result = envSchema.safeParse({ ...BASE_VALID_ENV, RATE_LIMIT_ENABLED: 'true' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('RATE_LIMIT_WINDOW_MS');
      expect(paths).toContain('RATE_LIMIT_MAX_REQUESTS');
    }
  });

  it('accepts RATE_LIMIT_ENABLED=true when both thresholds are supplied', () => {
    const result = envSchema.safeParse({
      ...BASE_VALID_ENV,
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX_REQUESTS: '100',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized LOG_LEVEL', () => {
    const result = envSchema.safeParse({ ...BASE_VALID_ENV, LOG_LEVEL: 'verbose' });
    expect(result.success).toBe(false);
  });
});
