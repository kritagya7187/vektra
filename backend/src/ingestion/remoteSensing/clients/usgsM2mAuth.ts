import type { Logger } from 'pino';
import { fetchWithRetry } from '../../shared/httpRetry';

/**
 * USGS EROS Machine-to-Machine (M2M) API authentication — confirmed
 * live during this milestone: a real application token (generated at
 * ers.cr.usgs.gov, scope "M2M API", per USGS's own "M2M Application
 * Token Documentation", 072024) exchanged for a real 72-character API
 * key via this exact endpoint and request shape.
 *
 * The application token itself is never sent on data requests — only
 * this login-token exchange consumes it. The returned API key is what
 * goes on every subsequent M2M call, in the X-Auth-Token header (per
 * the same USGS documentation).
 */

const M2M_LOGIN_TOKEN_URL = 'https://m2m.cr.usgs.gov/api/api/json/stable/login-token';

export interface UsgsM2mAuthOptions {
  readonly username: string | undefined;
  readonly applicationToken: string | undefined;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly logger: Logger;
}

interface LoginTokenResponseBody {
  readonly data?: string;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
}

export async function getUsgsM2mApiKey(options: UsgsM2mAuthOptions): Promise<string> {
  if (!options.username || !options.applicationToken) {
    throw new Error(
      'USGS_EROS_USERNAME and USGS_EROS_TOKEN must both be set to ingest Landsat data via the USGS M2M API (see backend/.env.example).',
    );
  }

  const response = await fetchWithRetry(
    M2M_LOGIN_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: options.username, token: options.applicationToken }),
    },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      logger: options.logger,
      serviceLabel: 'the USGS M2M API login-token endpoint',
    },
  );

  const parsed = (await response.json()) as LoginTokenResponseBody;
  if (parsed.errorCode) {
    throw new Error(`USGS M2M login-token failed: ${parsed.errorCode} - ${parsed.errorMessage}`);
  }
  if (!parsed.data) {
    throw new Error('USGS M2M login-token did not return an API key.');
  }
  return parsed.data;
}
