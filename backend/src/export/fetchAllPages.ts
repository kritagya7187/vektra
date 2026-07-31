import type { ListOptions } from '../types';

/**
 * Matches validators/pagination.ts's MAX_LIMIT — reusing the value
 * already established as this API's per-request page ceiling, rather
 * than picking a new arbitrary number for this internal loop.
 */
const EXPORT_BATCH_SIZE = 200;

/**
 * Every service's list() defaults to a 50-row page (the repository
 * layer's DEFAULT_LIST_LIMIT) — silently capping an "export everything"
 * request there would be wrong. This calls the SAME existing list()
 * signature repeatedly until a page comes back short of a full batch,
 * accumulating the complete result set. No new repository/service
 * capability — just the existing {limit, offset} contract, called in a
 * loop.
 */
export async function fetchAllPages<T>(
  list: (options: ListOptions) => Promise<readonly T[]>,
): Promise<readonly T[]> {
  const all: T[] = [];
  let offset = 0;

  for (;;) {
    const page = await list({ limit: EXPORT_BATCH_SIZE, offset });
    all.push(...page);
    if (page.length < EXPORT_BATCH_SIZE) {
      break;
    }
    offset += EXPORT_BATCH_SIZE;
  }

  return all;
}
