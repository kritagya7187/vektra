import { describe, expect, it } from 'vitest';
import { toCsv, type CsvColumn } from '../../../src/export/csv';

interface Row {
  readonly id: string;
  readonly name: string | null;
  readonly count: number;
  readonly when: Date;
}

const COLUMNS: readonly CsvColumn<Row>[] = [
  { header: 'id', value: (r) => r.id },
  { header: 'name', value: (r) => r.name },
  { header: 'count', value: (r) => r.count },
  { header: 'when', value: (r) => r.when },
];

describe('toCsv', () => {
  it('writes a header row followed by one row per input, in stable column order', () => {
    const rows: Row[] = [
      { id: '1', name: 'Alice', count: 3, when: new Date('2026-01-01T00:00:00Z') },
    ];
    const csv = toCsv(rows, COLUMNS);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,name,count,when');
    expect(lines[1]).toBe('1,Alice,3,2026-01-01T00:00:00.000Z');
  });

  it('renders null and undefined as empty cells', () => {
    const rows: Row[] = [{ id: '1', name: null, count: 0, when: new Date(0) }];
    const csv = toCsv(rows, COLUMNS);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe('1,,0,1970-01-01T00:00:00.000Z');
  });

  it('quotes a field containing a comma', () => {
    const rows: Row[] = [{ id: '1', name: 'Smith, Jane', count: 1, when: new Date(0) }];
    const csv = toCsv(rows, COLUMNS);
    expect(csv).toContain('"Smith, Jane"');
  });

  it('quotes a field containing a quote, doubling the internal quote (RFC 4180)', () => {
    const rows: Row[] = [{ id: '1', name: 'Say "hi"', count: 1, when: new Date(0) }];
    const csv = toCsv(rows, COLUMNS);
    expect(csv).toContain('"Say ""hi"""');
  });

  it('quotes a field containing a line break', () => {
    const rows: Row[] = [{ id: '1', name: 'line1\nline2', count: 1, when: new Date(0) }];
    const csv = toCsv(rows, COLUMNS);
    expect(csv).toContain('"line1\nline2"');
  });

  it('does not quote a plain field', () => {
    const rows: Row[] = [{ id: '1', name: 'plain', count: 1, when: new Date(0) }];
    const csv = toCsv(rows, COLUMNS);
    expect(csv.split('\r\n')[1]).toContain(',plain,');
  });

  it('produces only the header line (with a trailing CRLF) for zero rows', () => {
    const csv = toCsv([], COLUMNS);
    expect(csv).toBe('id,name,count,when\r\n');
  });

  it('is deterministic across repeated calls with the same input', () => {
    const rows: Row[] = [{ id: '1', name: 'Alice', count: 3, when: new Date(0) }];
    expect(toCsv(rows, COLUMNS)).toBe(toCsv(rows, COLUMNS));
  });
});
