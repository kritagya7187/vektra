import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { asyncHandler } from '../../../src/middleware/asyncHandler';

describe('asyncHandler', () => {
  it('calls through on success without invoking next', async () => {
    const handler = asyncHandler((_req, res) => {
      (res as unknown as { sent: boolean }).sent = true;
      return Promise.resolve();
    });
    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    handler(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect((res as unknown as { sent: boolean }).sent).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a rejected promise to next() — the entire reason this wrapper exists', async () => {
    const boom = new Error('async failure');
    const handler = asyncHandler(() => Promise.reject(boom));
    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    handler(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(boom);
  });
});
