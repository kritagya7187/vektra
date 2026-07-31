import { describe, expect, it } from 'vitest';
import { resolveLogLevelForStatus } from '../../../src/middleware/logLevel';

describe('resolveLogLevelForStatus', () => {
  it('maps 2xx/3xx to info', () => {
    expect(resolveLogLevelForStatus(200)).toBe('info');
    expect(resolveLogLevelForStatus(304)).toBe('info');
  });
  it('maps 4xx to warn', () => {
    expect(resolveLogLevelForStatus(400)).toBe('warn');
    expect(resolveLogLevelForStatus(404)).toBe('warn');
  });
  it('maps 5xx to error', () => {
    expect(resolveLogLevelForStatus(500)).toBe('error');
    expect(resolveLogLevelForStatus(503)).toBe('error');
  });
});
