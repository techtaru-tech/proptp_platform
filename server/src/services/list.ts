import type { Request } from 'express';

/**
 * Shared list-query parsing. Every admin list endpoint returns the same
 * `{ items, total, page, pageSize }` envelope the frontend's `ListResult<T>` already
 * expects, so no call site had to change when these moved off mock data.
 */

export interface ParsedListQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  search: string;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
}

export function parseListQuery(req: Request, defaultPageSize = 10): ParsedListQuery {
  const page = Math.max(1, Number(req.query.page) || 1);
  // Capped so a bad/hostile `pageSize` cannot ask for the whole table.
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || defaultPageSize));
  const sortBy = req.query.sortBy ? String(req.query.sortBy) : undefined;
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    search: String(req.query.search ?? '').trim(),
    sortBy,
    sortDir: req.query.sortDir === 'desc' ? 'desc' : 'asc',
  };
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function listResult<T>(items: T[], total: number, query: ParsedListQuery): ListResult<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/**
 * Sorts and paginates in memory. Used only by the handful of list endpoints whose sort key
 * is a DERIVED value (a project's remaining balance, an investment's bucket) and therefore
 * cannot be expressed as a Prisma `orderBy`. Everything else paginates in SQL.
 */
export function paginateInMemory<T>(
  all: T[],
  query: ParsedListQuery,
  compare?: (a: T, b: T, sortBy: string) => number
): ListResult<T> {
  let items = all;
  if (query.sortBy && compare) {
    const dir = query.sortDir === 'desc' ? -1 : 1;
    items = [...all].sort((a, b) => compare(a, b, query.sortBy!) * dir);
  }
  return listResult(items.slice(query.skip, query.skip + query.take), all.length, query);
}

/** A case-insensitive `contains` filter, or undefined when there is no search term. */
export function contains(search: string) {
  return search ? { contains: search, mode: 'insensitive' as const } : undefined;
}
