import type { Response } from 'express';
import type { ApiSuccessResponse } from '../types';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/**
 * The one place any controller builds a success response body. Every
 * controller in this subsystem calls this (or sendCreated) instead of
 * calling res.json() directly, so the `{ data }` envelope
 * (types/apiResponse.ts, proposed in the earlier architectural review)
 * cannot drift between endpoints.
 *
 * No `meta` parameter: nothing in this subsystem populates
 * `meta.pagination` (PaginationMeta.total needs a row-count capability no
 * service currently exposes) — adding an unused parameter here would
 * invite a future caller to fabricate a fake total rather than building
 * that capability properly. Add it when a real caller needs it.
 */
export function sendData<T>(res: Response, data: T, statusCode: number = HTTP_OK): void {
  const body: ApiSuccessResponse<T> = { data };
  res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, data: T): void {
  sendData(res, data, HTTP_CREATED);
}
