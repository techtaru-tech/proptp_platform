/**
 * Shared mock-transport helpers. Every service function in `src/services` goes through
 * `resolveAfter` so call sites already look and behave like real async API calls
 * (loading states, latency, rejected promises). Swapping a service's internals for a
 * real `fetch`/axios call to the Laravel API later requires no change to callers.
 */

const DEFAULT_LATENCY_MS = 350;

export function resolveAfter<T>(value: T, ms: number = DEFAULT_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function rejectAfter(message: string, ms: number = DEFAULT_LATENCY_MS): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  [key: string]: unknown;
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Generic in-memory filter + sort + paginate, standing in for server-side query params. */
export function paginate<T>(
  all: T[],
  params: ListParams,
  matchers: {
    search?: (item: T, query: string) => boolean;
    filter?: (item: T, params: ListParams) => boolean;
    sort?: (a: T, b: T, sortBy: string) => number;
  } = {}
): ListResult<T> {
  let items = [...all];

  if (matchers.filter) {
    items = items.filter((item) => matchers.filter!(item, params));
  }

  if (params.search && matchers.search) {
    const q = params.search.trim().toLowerCase();
    if (q) items = items.filter((item) => matchers.search!(item, q));
  }

  if (params.sortBy && matchers.sort) {
    const dir = params.sortDir === 'desc' ? -1 : 1;
    items = items.sort((a, b) => matchers.sort!(a, b, params.sortBy!) * dir);
  }

  const total = items.length;
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return { items: pageItems, total, page, pageSize };
}
