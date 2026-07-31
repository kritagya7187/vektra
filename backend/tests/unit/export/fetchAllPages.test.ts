import { describe, expect, it } from 'vitest';
import { fetchAllPages } from '../../../src/export/fetchAllPages';

describe('fetchAllPages', () => {
  it('returns everything in one call when the first page is short (fewer than the batch size)', async () => {
    const calls: unknown[] = [];
    const result = await fetchAllPages((options) => {
      calls.push(options);
      return Promise.resolve([1, 2, 3]);
    });
    expect(result).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
  });

  it('loops across multiple pages until a short page is returned, accumulating everything', async () => {
    const pages = [
      Array.from({ length: 200 }, (_v, i) => i),
      Array.from({ length: 200 }, (_v, i) => 200 + i),
      Array.from({ length: 50 }, (_v, i) => 400 + i),
    ];
    let callIndex = 0;
    const offsetsSeen: number[] = [];

    const result = await fetchAllPages((options) => {
      offsetsSeen.push(options.offset ?? -1);
      const page = pages[callIndex] ?? [];
      callIndex += 1;
      return Promise.resolve(page);
    });

    expect(result).toHaveLength(450);
    expect(offsetsSeen).toEqual([0, 200, 400]);
    expect(callIndex).toBe(3);
  });

  it('returns an empty array when the underlying list is empty', async () => {
    const result = await fetchAllPages(() => Promise.resolve([]));
    expect(result).toEqual([]);
  });

  it('propagates an error from the underlying list function', async () => {
    await expect(
      fetchAllPages(() => Promise.reject(new Error('downstream failure'))),
    ).rejects.toThrow('downstream failure');
  });
});
