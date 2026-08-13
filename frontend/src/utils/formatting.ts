const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
export function formatTimestamp(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}
export function formatNullableNumber(value: number | null, unit?: string): string {
  if (value === null) {
    return '—';
  }
  const rounded = Math.round(value * 100) / 100;
  return unit ? `${rounded} ${unit}` : String(rounded);
}
export function formatNullableText(value: string | null): string {
  return value === null || value.length === 0 ? '—' : value;
}
const RUN_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
export function formatRunStatus(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}
export function formatUnknown(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
