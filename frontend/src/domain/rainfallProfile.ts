import type { RainfallDay } from '../api';

export interface RainfallProfileEntry {
  readonly date: string;
  readonly totalMm: number;
  readonly intensity: number;
  readonly isSelected: boolean;
}

export function computeMonthlyProfile(
  days: readonly RainfallDay[],
  monthKey: string,
  selectedDate: string | null,
): RainfallProfileEntry[] {
  const monthDays = days.filter((day) => day.date.slice(0, 7) === monthKey);
  const maxTotal = monthDays.reduce((max, day) => Math.max(max, day.totalMm), 0);
  return monthDays
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({
      date: day.date,
      totalMm: day.totalMm,
      intensity: maxTotal > 0 ? day.totalMm / maxTotal : 0,
      isSelected: day.date === selectedDate,
    }));
}
