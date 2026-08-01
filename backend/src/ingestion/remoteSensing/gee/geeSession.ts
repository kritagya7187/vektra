import { readFileSync } from 'node:fs';
import type { Logger } from 'pino';
import * as ee from '@google/earthengine';
import { ExternalServiceError } from '../../../errors/ExternalServiceError';

/**
 * Google Earth Engine authentication/initialization — a promisified
 * wrapper around @google/earthengine's Node-callback-style API (real
 * signatures confirmed by reading node_modules/@google/earthengine/src/
 * directly, not assumed): `ee.data.authenticateViaPrivateKey(keyJson,
 * onSuccess, onError)` followed by `ee.initialize(null, null, onSuccess,
 * onError, null, projectId)`.
 *
 * Unlike ADC-aware Google libraries, authenticateViaPrivateKey does NOT
 * read GOOGLE_APPLICATION_CREDENTIALS itself — it expects the already
 * parsed key object, so this module reads and parses the file explicitly.
 *
 * The in-flight/resolved init Promise itself (not a boolean flag) is the
 * memoized singleton state: a failed init resets it to null so the next
 * call retries cleanly, rather than permanently caching a broken
 * "looks initialized" state that a later concurrent caller would trust.
 */

export interface GeeSessionOptions {
  readonly serviceAccountKeyPath: string | undefined;
  readonly projectId: string | undefined;
  readonly logger: Logger;
}

let initPromise: Promise<void> | null = null;

function readServiceAccountKey(path: string): ee.data.AuthPrivateKey {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read Google Earth Engine service account key at '${path}': ${String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Google Earth Engine service account key at '${path}' is not valid JSON: ${String(err)}`,
    );
  }

  const key = parsed as Partial<ee.data.AuthPrivateKey>;
  if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    throw new Error(
      `Google Earth Engine service account key at '${path}' is missing 'client_email' or 'private_key' — is this a real downloaded service account JSON key?`,
    );
  }
  return key as ee.data.AuthPrivateKey;
}

async function initializeOnce(
  options: GeeSessionOptions & { readonly keyPath: string; readonly projectId: string },
): Promise<void> {
  const key = readServiceAccountKey(options.keyPath);

  await new Promise<void>((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      key,
      () => {
        ee.initialize(
          null,
          null,
          () => {
            options.logger.info(
              { projectId: options.projectId, serviceAccount: key.client_email },
              'Google Earth Engine session initialized',
            );
            resolve();
          },
          (error: string) => {
            reject(
              new ExternalServiceError(`Google Earth Engine ee.initialize() failed: ${error}`),
            );
          },
          null,
          options.projectId,
        );
      },
      (error: string) => {
        reject(
          new ExternalServiceError(
            `Google Earth Engine authenticateViaPrivateKey() failed: ${error}`,
          ),
        );
      },
    );
  });
}

/**
 * Ensures the process-wide GEE session is authenticated and initialized,
 * memoized so repeated calls within one CLI invocation are free. Every
 * GEE-backed client must call this before touching the `ee` namespace.
 */
export async function ensureGeeInitialized(options: GeeSessionOptions): Promise<void> {
  if (!options.serviceAccountKeyPath || !options.projectId) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT_ID must both be set to ingest raster data via Google Earth Engine (see backend/.env.example).',
    );
  }
  const keyPath = options.serviceAccountKeyPath;
  const projectId = options.projectId;

  if (initPromise === null) {
    initPromise = initializeOnce({ ...options, keyPath, projectId }).catch((err: unknown) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/** Current bearer token after a successful ensureGeeInitialized() — used to authorize the manual getDownloadURL byte-fetch. */
export function getGeeAuthToken(): string {
  return ee.data.getAuthToken();
}

/** Test-only escape hatch to reset the memoized session between test runs. Not used by production code paths. */
export function resetGeeSessionForTests(): void {
  initPromise = null;
}
