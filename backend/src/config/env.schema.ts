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

// Remote Sensing Ingestion subsystem (Phase 3 Milestone 2 — Remote
// Sensing Foundation). Every default below was verified against the
// real, live provider this session, not assumed:
//
// - SENTINEL_HUB_PROCESS_API_URL: the earlier assumption that Sentinel-2
//   lived on catalogue.dataspace.copernicus.eu/stac was WRONG — that
//   endpoint hosts only CLMS land-monitoring collections (verified: 418
//   collections listed, none Sentinel-2). The real mechanism is the
//   Sentinel Hub Process API, confirmed live with a real OAuth2 token
//   (COPERNICUS_CLIENT_ID/SECRET) returning a real bbox-scoped GeoTIFF
//   for Sentinel-2 L2A (type "S2L2A"). Landsat Collection 2 Level-2 uses
//   the SAME endpoint with type "landsat-ot-l2" (confirmed real —
//   the API's own error resolved it to internal code "LOTL2" — but this
//   account's access to that specific collection was not yet resolved
//   at verification time; see LandsatClient.ts).
// - ESA_WORLDCOVER_S3_BASE_URL: WorldCover is NOT behind Copernicus
//   auth at all — it's a fully public, unauthenticated AWS S3 bucket.
//   Confirmed live: a byte-range read against the real South Mumbai
//   tile returned a valid TIFF, Accept-Ranges: bytes confirmed (COG).
// - SRTM_DEM_API_URL: OpenTopography globaldem, confirmed live with
//   OPENTOPOGRAPHY_API_KEY — a real 6x6px 16-bit elevation GeoTIFF was
//   returned for a test bbox.
// - OPEN_METEO_API_URL: real, verified, public (no auth) — confirmed by
//   a real end-to-end ingestion run in an earlier phase.
const DEFAULT_COPERNICUS_TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const DEFAULT_SENTINEL_HUB_PROCESS_API_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const DEFAULT_ESA_WORLDCOVER_S3_BASE_URL = 'https://esa-worldcover.s3.amazonaws.com';
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
    SENTINEL_HUB_PROCESS_API_URL: z.string().url().default(DEFAULT_SENTINEL_HUB_PROCESS_API_URL),
    ESA_WORLDCOVER_S3_BASE_URL: z.string().url().default(DEFAULT_ESA_WORLDCOVER_S3_BASE_URL),
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

    // Copernicus Data Space Ecosystem OAuth2 client_credentials — powers
    // both Sentinel-2 and Landsat access via SENTINEL_HUB_PROCESS_API_URL
    // above. No default: there is no safe placeholder for a real secret.
    // Optional at the schema level (like OVERPASS_API_URL's siblings)
    // because only the raster ingestion CLI entry points need it, never
    // the HTTP server — each client throws its own clear error if
    // invoked without it, rather than blocking server startup.
    COPERNICUS_CLIENT_ID: z.string().min(1).optional(),
    COPERNICUS_CLIENT_SECRET: z.string().min(1).optional(),
    COPERNICUS_TOKEN_URL: z.string().url().default(DEFAULT_COPERNICUS_TOKEN_URL),

    // OpenTopography — powers SRTM_DEM_API_URL above. Same "optional
    // here, required by the specific client at point of use" reasoning.
    OPENTOPOGRAPHY_API_KEY: z.string().min(1).optional(),

    // USGS EROS M2M API — an alternative, independently-credentialed
    // Landsat access path from the Copernicus one above (see
    // LandsatClient.ts / usgsM2mAuth.ts for exactly what this milestone
    // verified live and where it currently stops). USGS_EROS_TOKEN is
    // the M2M "application token" (ers.cr.usgs.gov, scope "M2M API"),
    // never the account password.
    USGS_EROS_USERNAME: z.string().min(1).optional(),
    USGS_EROS_TOKEN: z.string().min(1).optional(),

    // Filesystem directory raw downloaded raster files are written to
    // (Task 3: reproducible storage, no hard-coded path). No default —
    // unlike an ingestion API URL, there is no "correct" default
    // directory to assume; the operator must say where, the same way
    // POSTGRES_HOST has no default. Only required by raster ingestion.
    RASTER_STORAGE_DIR: z.string().min(1).optional(),
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
