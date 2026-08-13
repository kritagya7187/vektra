import { config } from '../config';
import { ApiError, type ApiErrorBody, type ApiErrorCode } from './errors';
interface ApiSuccessResponse<T> {
  readonly data: T;
}
interface ApiErrorResponseBody {
  readonly error: ApiErrorBody;
}
const KNOWN_ERROR_CODES: readonly ApiErrorCode[] = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'DATABASE_ERROR',
  'INTERNAL_SERVER_ERROR',
  'EXTERNAL_SERVICE_ERROR',
];
function toApiErrorCode(code: string): ApiErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code)
    ? (code as ApiErrorCode)
    : 'UNKNOWN_ERROR';
}
function buildUrl(path: string, params?: Record<string, string | undefined>): string {
  const url = new URL(path, config.apiBaseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}
async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
function isApiErrorResponseBody(value: unknown): value is ApiErrorResponseBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object'
  );
}
export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = buildUrl(path, params);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (cause) {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the VEKTRA API. Check your connection and try again.',
      status: null,
      cause,
    });
  }
  const body = await safeParseJson(response);
  if (!response.ok) {
    if (isApiErrorResponseBody(body)) {
      throw new ApiError({
        code: toApiErrorCode(body.error.code),
        message: body.error.message,
        status: response.status,
        requestId: body.error.requestId,
        details: body.error.details,
      });
    }
    throw new ApiError({
      code: 'UNKNOWN_ERROR',
      message: `The API returned an unexpected error (HTTP ${response.status}).`,
      status: response.status,
    });
  }
  if (body === null || typeof body !== 'object' || !('data' in (body as Record<string, unknown>))) {
    throw new ApiError({
      code: 'UNKNOWN_ERROR',
      message: 'The API returned a response in an unexpected shape.',
      status: response.status,
    });
  }
  return (body as ApiSuccessResponse<T>).data;
}
export function getJson<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  return requestJson<T>(path, { method: 'GET' }, params);
}
export async function getRawJson<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = buildUrl(path, params);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/geo+json' } });
  } catch (cause) {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the VEKTRA API. Check your connection and try again.',
      status: null,
      cause,
    });
  }
  const body = await safeParseJson(response);
  if (!response.ok) {
    if (isApiErrorResponseBody(body)) {
      throw new ApiError({
        code: toApiErrorCode(body.error.code),
        message: body.error.message,
        status: response.status,
        requestId: body.error.requestId,
        details: body.error.details,
      });
    }
    throw new ApiError({
      code: 'UNKNOWN_ERROR',
      message: `The API returned an unexpected error (HTTP ${response.status}).`,
      status: response.status,
    });
  }
  if (body === null) {
    throw new ApiError({
      code: 'UNKNOWN_ERROR',
      message: 'The API returned an empty response.',
      status: response.status,
    });
  }
  return body as T;
}
export function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
export function exportUrl(path: string, params?: Record<string, string | undefined>): string {
  return buildUrl(path, params);
}
