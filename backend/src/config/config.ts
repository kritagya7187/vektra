import 'dotenv/config';
import { envSchema, type Env } from './env.schema';

/**
 * Validates process.env against envSchema and exits the process on
 * failure. This runs before the structured logger (src/logging) can be
 * constructed — the logger's own level is read from this config — so a
 * plain console.error here is the one deliberate exception to "no
 * console.log outside startup" (see eslint.config.js override for
 * src/config and src/server.ts).
 */
function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return parsed.data;
}

const env = loadEnv();

export type RateLimitConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly windowMs: number; readonly maxRequests: number };

export interface AppConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly isProduction: boolean;
  readonly server: {
    readonly port: number;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly password: string;
  };
  readonly cors: {
    readonly allowedOrigins: readonly string[];
  };
  readonly rateLimit: RateLimitConfig;
  readonly logging: {
    readonly level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  };
  readonly overpass: {
    readonly apiUrl: string;
    readonly timeoutMs: number;
    readonly maxRetries: number;
  };
}

function buildRateLimitConfig(): RateLimitConfig {
  if (!env.RATE_LIMIT_ENABLED) {
    return { enabled: false };
  }
  // envSchema.superRefine guarantees these are present when enabled=true.
  return {
    enabled: true,
    windowMs: env.RATE_LIMIT_WINDOW_MS as number,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS as number,
  };
}

export const config: AppConfig = Object.freeze({
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  server: Object.freeze({
    port: env.BACKEND_PORT,
  }),
  database: Object.freeze({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
  }),
  cors: Object.freeze({
    allowedOrigins: Object.freeze(env.CORS_ALLOWED_ORIGINS),
  }),
  rateLimit: Object.freeze(buildRateLimitConfig()),
  logging: Object.freeze({
    level: env.LOG_LEVEL,
  }),
  overpass: Object.freeze({
    apiUrl: env.OVERPASS_API_URL,
    timeoutMs: env.OVERPASS_TIMEOUT,
    maxRetries: env.OVERPASS_MAX_RETRIES,
  }),
});
