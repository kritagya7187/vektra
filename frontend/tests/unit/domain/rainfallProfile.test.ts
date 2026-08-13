import { describe, expect, it } from 'vitest';
import { computeMonthlyProfile } from '../../../src/domain/rainfallProfile';

const DAYS = [
  { date: '2020-07-01', totalMm: 10, maxHourlyMm: 2 },
  { date: '2020-07-03', totalMm: 40, maxHourlyMm: 8 },
  { date: '2020-07-02', totalMm: 20, maxHourlyMm: 3 },
  { date: '2020-08-01', totalMm: 5, maxHourlyMm: 1 },
];

describe('computeMonthlyProfile', () => {
  it('keeps only real days within the given month', () => {
    const profile = computeMonthlyProfile(DAYS, '2020-07', null);
    expect(profile.map((entry) => entry.date)).toEqual(['2020-07-01', '2020-07-02', '2020-07-03']);
  });
  it('returns entries sorted chronologically regardless of input order', () => {
    const profile = computeMonthlyProfile(DAYS, '2020-07', null);
    expect(profile[0].date).toBe('2020-07-01');
    expect(profile[2].date).toBe('2020-07-03');
  });
  it("scales intensity relative to the month's own real maximum", () => {
    const profile = computeMonthlyProfile(DAYS, '2020-07', null);
    const day3 = profile.find((entry) => entry.date === '2020-07-03');
    expect(day3?.intensity).toBe(1);
    const day1 = profile.find((entry) => entry.date === '2020-07-01');
    expect(day1?.intensity).toBeCloseTo(0.25);
  });
  it('marks exactly the selected date', () => {
    const profile = computeMonthlyProfile(DAYS, '2020-07', '2020-07-02');
    expect(profile.find((entry) => entry.date === '2020-07-02')?.isSelected).toBe(true);
    expect(profile.find((entry) => entry.date === '2020-07-01')?.isSelected).toBe(false);
  });
  it('returns an empty profile for a month with no real data', () => {
    expect(computeMonthlyProfile(DAYS, '2020-09', null)).toEqual([]);
  });
});
