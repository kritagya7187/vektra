import supertest from 'supertest';
import { createApp } from '../../src/app';

/**
 * app.ts's createApp() is a factory with no shared state by design
 * ("importable... without one test's middleware state leaking into
 * another's") — a fresh instance per call is cheap and matches that
 * intent exactly.
 */
export function testApp(): ReturnType<typeof supertest> {
  return supertest(createApp());
}
