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

// OSM Ingestion subsystem. Real, documented defaults (not arbitrary):
// overpass-api.de is the actual public endpoint named in the EDD's own
// risk register (Section "Known Limitations"). 60s/3 retries are
// technical tuning values (comparable to database/pool.ts's
// CONNECTION_TIMEOUT_MS), not policy/security thresholds — unlike
// RATE_LIMIT_*, a default here doesn't hide a business decision.
const DEFAULT_OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const DEFAULT_OVERPASS_TIMEOUT_MS = 60_000;
const DEFAULT_OVERPASS_MAX_RETRIES = 3;

// Remote Sensing Ingestion subsystem. Per-source endpoints (a real URL
// genuinely differs per provider) but ONE shared timeout/retry pair —
// ten per-source tuning values would be exactly the config duplication
// this subsystem's own brief warns against. Confidence in these
// defaults varies and is stated honestly per source in the engineering
// review: OPEN_METEO_API_URL is the real, verified, public endpoint
// (archive-api.open-meteo.com, no auth required — confirmed by a real
// end-to-end run). SENTINEL2/LANDSAT point at the real STAC-hosting
// domains (Copernicus Data Space / USGS LandsatLook) but require
// credentials this environment doesn't have, so the exact catalog path
// is a best-effort default, not a verified one. ESA_WORLDCOVER/SRTM_DEM
// have no single ubiquitous metadata-query API the way STAC-based
// sources do — their defaults are placeholders pending real integration
// research, explicitly flagged as such rather than presented with false
// confidence.
const DEFAULT_SENTINEL2_API_URL = 'https://catalogue.dataspace.copernicus.eu/stac';
const DEFAULT_LANDSAT_API_URL = 'https://landsatlook.usgs.gov/stac-server/search';
const DEFAULT_ESA_WORLDCOVER_API_URL = 'https://services.terrascope.be/catalogue/products';
const DEFAULT_SRTM_DEM_API_URL = 'https://portal.opentopography.org/API/globaldem';
const DEFAULT_OPEN_METEO_API_URL = 'https://archive-api.open-meteo.com/v1/archive';
const DEFAULT_REMOTE_SENSING_TIMEOUT_MS = 60_000;
const DEFAULT_REMOTE_SENSING_MAX_RETRIES = 3;

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

    // OSM Ingestion subsystem (EDD FR-1, Section 14). Only consumed by
    // the ingestion CLI entry point, never by the HTTP server — declared
    // here anyway so it goes through the same single validated config
    // surface as everything else, per this subsystem's own instruction
    // to reuse (not duplicate) the configuration layer.
    OVERPASS_API_URL: z.string().url().default(DEFAULT_OVERPASS_API_URL),
    OVERPASS_TIMEOUT: z.coerce.number().int().positive().default(DEFAULT_OVERPASS_TIMEOUT_MS),
    OVERPASS_MAX_RETRIES: z.coerce.number().int().min(0).default(DEFAULT_OVERPASS_MAX_RETRIES),

    // Remote Sensing Ingestion subsystem (EDD FR-2..FR-5, Section 14).
    SENTINEL2_API_URL: z.string().url().default(DEFAULT_SENTINEL2_API_URL),
    LANDSAT_API_URL: z.string().url().default(DEFAULT_LANDSAT_API_URL),
    ESA_WORLDCOVER_API_URL: z.string().url().default(DEFAULT_ESA_WORLDCOVER_API_URL),
    SRTM_DEM_API_URL: z.string().url().default(DEFAULT_SRTM_DEM_API_URL),
    OPEN_METEO_API_URL: z.string().url().default(DEFAULT_OPEN_METEO_API_URL),
    REMOTE_SENSING_TIMEOUT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_REMOTE_SENSING_TIMEOUT_MS),
    REMOTE_SENSING_MAX_RETRIES: z.coerce
      .number()
      .int()
      .min(0)
      .default(DEFAULT_REMOTE_SENSING_MAX_RETRIES),
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
