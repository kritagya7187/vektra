/**
 * Pure CSV serialization — no Express, no service imports. Reused by
 * every resource's export controller so column-order/escaping/null
 * handling exists exactly once (EDD FR-13's "tabular format such as
 * CSV").
 */

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number | boolean | Date | null | undefined;
}

const CRLF = '\r\n';
const CSV_SPECIAL_CHARS = /["\r\n,]/;

/** RFC 4180: quote a field containing a comma, quote, or line break; double any internal quotes. */
function escapeCsvField(raw: string): string {
  if (!CSV_SPECIAL_CHARS.test(raw)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function formatCell(value: string | number | boolean | Date | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return escapeCsvField(raw);
}

/**
 * Deterministic, hand-ordered columns (never `Object.keys`) — "stable
 * column ordering" per this subsystem's brief. Ends with a trailing
 * CRLF after the last row (no extra blank line).
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const headerLine = columns.map((column) => escapeCsvField(column.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((column) => formatCell(column.value(row))).join(','),
  );
  return [headerLine, ...dataLines].join(CRLF) + CRLF;
}
