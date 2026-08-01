import type { Logger } from 'pino';
import { fetchWithRetry } from '../../shared/httpRetry';

/**
 * Copernicus Data Space Ecosystem OAuth2 client_credentials grant.
 * Real endpoint and flow, confirmed live during this milestone's
 * verification (a real Bearer token was obtained and used for real
 * Sentinel-2/Landsat Process API calls) — this is not a placeholder
 * against an assumed shape.
 */

export interface CopernicusAuthOptions {
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  readonly tokenUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger: Logger;
}

interface TokenResponseBody {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

export async function getCopernicusAccessToken(options: CopernicusAuthOptions): Promise<string> {
  if (!options.clientId || !options.clientSecret) {
    throw new Error(
      'COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET must both be set to ingest Sentinel-2 or Landsat data (see backend/.env.example).',
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });

  const response = await fetchWithRetry(
    options.tokenUrl,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      logger: options.logger,
      serviceLabel: 'the Copernicus Data Space Ecosystem identity server',
    },
  );

  const parsed = (await response.json()) as TokenResponseBody;
  if (!parsed.access_token) {
    throw new Error(
      `Copernicus OAuth2 token request did not return an access_token (${parsed.error ?? 'unknown error'}: ${parsed.error_description ?? 'no description'}).`,
    );
  }
  return parsed.access_token;
}
