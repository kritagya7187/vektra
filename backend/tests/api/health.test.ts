import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/testApp';

describe('GET /health', () => {
  it('returns 200 with connected:true / postgis available against the real container', async () => {
    const res = await testApp().get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.connected).toBe(true);
    expect(res.body.database.postgis.available).toBe(true);
    expect(res.body.timestamp).toEqual(expect.any(String));
  });

  it('uses its own documented shape, not the standard {data} success envelope', async () => {
    const res = await testApp().get('/health');
    expect(res.body).not.toHaveProperty('data');
  });
});
