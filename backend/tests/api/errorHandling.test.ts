import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/testApp';

describe('cross-cutting error handling / request lifecycle', () => {
  it('an unmatched route produces a 404 through the same envelope as any other error', async () => {
    const res = await testApp().get('/api/does-not-exist-at-all');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('/api/does-not-exist-at-all');
  });

  it('every response carries a unique X-Request-Id header', async () => {
    const first = await testApp().get('/health');
    const second = await testApp().get('/health');
    expect(first.headers['x-request-id']).toEqual(expect.any(String));
    expect(second.headers['x-request-id']).toEqual(expect.any(String));
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('the error envelope echoes the same request id back in the body', async () => {
    const res = await testApp().get('/api/does-not-exist-at-all');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('the error envelope has exactly the 4 documented keys, regardless of error type', async () => {
    const res = await testApp().get('/api/buildings/not-a-uuid');
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'details', 'message', 'requestId']);
  });
});
