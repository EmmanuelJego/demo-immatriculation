export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export interface PageQuery {
  readonly after: number;
  readonly limit: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly after: number;
  readonly limit: number;
  readonly nextAfter: number | null;
}

// Expects up to `limit + 1` rows: the extra one only signals that a next
// page exists, and is not returned.
export function toPage<T>(
  rows: readonly T[],
  query: PageQuery,
  cursorOf: (item: T) => number,
): Page<T> {
  const items = rows.slice(0, query.limit);
  const hasNextPage = rows.length > query.limit;
  return {
    ...query,
    items,
    nextAfter: hasNextPage ? cursorOf(items[items.length - 1]) : null,
  };
}
