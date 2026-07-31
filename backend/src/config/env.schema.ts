import { z } from 'zod';

/**
 * Runtime environment schema for the VEKTRA backend.
 *
 * Only variables this service actually consumes are declared here.
 * CESIUM_ION_TOKEN and TOMTOM_API_KEY (present in the repo-root
 * .env.example for the frontend, EDD Section 12/20/33) are deliberately
 * absent — this service has no reason to read them.
 *
 * API_AUTH_SECRET is also deliberately absent. Authentication/authorization
 * is "Not specified" in EDD Section 23; per project constraint, this phase
 * must not consume or enforce it.
 */

const DEFAULT_BACKEND_PORT = 3000;
const DEFAULT_POSTGRES_PORT = 5432;

function csvToOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    BACKEND_PORT: z.coerce.number().int().positive().default(DEFAULT_BACKEND_PORT),

    POSTGRES_HOST: z.string().min(1, 'POSTGRES_HOST is required'),
    POSTGRES_PORT: z.coerce.number().int().positive().default(DEFAULT_POSTGRES_PORT),
    POSTGRES_DB: z.string().min(1, 'POSTGRES_DB is required'),
    POSTGRES_USER: z.string().min(1, 'POSTGRES_USER is required'),
    POSTGRES_PASSWORD: z.string().min(1, 'POSTGRES_PASSWORD is required'),

    // Empty/unset means "deny all cross-origin requests" (Section 33:
    // "restricted to known frontend origins" — not "restricted, or open
    // by default until we know better").
    CORS_ALLOWED_ORIGINS: z.string().optional().transform(csvToOrigins),

    // Disabled by default per project constraint. No numeric default is
    // provided for the two threshold fields — see the superRefine below.
    RATE_LIMIT_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((env, ctx) => {
    // Enforced here rather than via .default(): a fallback threshold would
    // still be an arbitrary hard-coded number, just a hidden one. If rate
    // limiting is turned on, the operator must say by how much.
    if (!env.RATE_LIMIT_ENABLED) {
      return;
    }
    if (env.RATE_LIMIT_WINDOW_MS === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RATE_LIMIT_WINDOW_MS'],
        message: 'required when RATE_LIMIT_ENABLED=true (no default threshold is assumed)',
      });
    }
    if (env.RATE_LIMIT_MAX_REQUESTS === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RATE_LIMIT_MAX_REQUESTS'],
        message: 'required when RATE_LIMIT_ENABLED=true (no default threshold is assumed)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
