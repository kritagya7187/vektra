import { describe, expect, it } from 'vitest';
import { arrivalColor, depthColor, durationColor } from '../../../src/domain/colormap';

describe('depthColor', () => {
  it('returns fully transparent for a zero or negative depth', () => {
    expect(depthColor(0, 5)).toEqual([0, 0, 0, 0]);
    expect(depthColor(-1, 5)).toEqual([0, 0, 0, 0]);
  });

  it('returns fully transparent when the run maximum is zero (a completely dry run)', () => {
    expect(depthColor(1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('returns fully transparent for a non-finite depth', () => {
    expect(depthColor(NaN, 5)).toEqual([0, 0, 0, 0]);
    expect(depthColor(Infinity, 5)).toEqual([0, 0, 0, 0]);
  });

  it('returns an opaque color for a positive depth within range', () => {
    const [r, g, b, a] = depthColor(2.5, 5);
    expect(a).toBe(255);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  it('produces a different color at the low end than the high end of the range (a real ramp, not a constant)', () => {
    const low = depthColor(0.1, 10);
    const high = depthColor(9.9, 10);
    expect(low).not.toEqual(high);
  });

  it('honors a custom alpha', () => {
    const [, , , a] = depthColor(2, 5, 128);
    expect(a).toBe(128);
  });
});

describe('arrivalColor', () => {
  it('returns fully transparent for null (flood-engine\'s own "threshold never crossed" sentinel)', () => {
    expect(arrivalColor(null, 60)).toEqual([0, 0, 0, 0]);
  });

  it('returns fully transparent for a non-finite value', () => {
    expect(arrivalColor(NaN, 60)).toEqual([0, 0, 0, 0]);
  });

  it('returns fully transparent when the run maximum is zero', () => {
    expect(arrivalColor(5, 0)).toEqual([0, 0, 0, 0]);
  });

  it('returns an opaque color for a real arrival time', () => {
    const [, , , a] = arrivalColor(30, 60);
    expect(a).toBe(255);
  });
});

describe('durationColor', () => {
  it('returns fully transparent for a zero or negative duration', () => {
    expect(durationColor(0, 30)).toEqual([0, 0, 0, 0]);
  });

  it('returns an opaque color for a positive duration within range', () => {
    const [, , , a] = durationColor(15, 30);
    expect(a).toBe(255);
  });
});
