/**
 * Fetch wrapper for the Rosium platform backend (server/ — Express + Prisma + PostgreSQL).
 * Every service function goes through this, so the API base URL, the Authorization header
 * and error normalisation live in exactly one place.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';

const SESSION_KEY = 'rosium_admin_session';

/** Where the origin serving /uploads lives — the API base minus its trailing /api. */
export const FILE_BASE_URL = BASE_URL.replace(/\/api\/?$/, '');

/** Turns a stored root-relative upload path into a URL the browser can load. */
export function fileUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  return path.startsWith('/uploads/') ? `${FILE_BASE_URL}${path}` : path;
}

function storedToken(): string | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
  } catch {
    return undefined;
  }
}

/** Raised on a 401 so the auth context can drop the session instead of showing an error. */
export class UnauthorizedError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Clearing localStorage is not enough on its own: the app is already rendered from state held
 * in memory, so a device whose session was signed out elsewhere would keep showing the panel
 * until someone reloaded it. Listeners here let the auth context drop that state the moment
 * any request comes back 401.
 */
type UnauthorizedListener = (reason: string) => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** Survives the redirect to /login, which is a fresh render with no props to carry it. */
const SIGNED_OUT_REASON_KEY = 'rosium_signed_out_reason';

export function takeSignedOutReason(): string | null {
  try {
    const reason = sessionStorage.getItem(SIGNED_OUT_REASON_KEY);
    if (reason) sessionStorage.removeItem(SIGNED_OUT_REASON_KEY);
    return reason;
  } catch {
    return null;
  }
}

/**
 * The backend returns `{ error: "..." }` on admin routes and `{ error: { code, message } }`
 * on app routes; both are unwrapped to a plain message here so call sites never branch.
 */
function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
  }
  return `Request failed (${status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = storedToken();
  const isFormData = init?.body instanceof FormData;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      // FormData must set its own multipart boundary, so Content-Type is left off for it.
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    // The server says why — "this device was signed out" reads very differently from "your
    // session expired", and the login screen shows whichever it was.
    const body = await res.json().catch(() => ({}));
    // A 401 from something other than the API (nginx, say) carries no message worth showing.
    const parsed = messageFrom(body, 401);
    const reason = parsed === 'Request failed (401)' ? 'Your session has expired. Please sign in again.' : parsed;
    localStorage.removeItem(SESSION_KEY);
    try {
      sessionStorage.setItem(SIGNED_OUT_REASON_KEY, reason);
    } catch {
      // A private window with storage blocked still signs out; it just says less about why.
    }
    unauthorizedListeners.forEach((listener) => listener(reason));
    throw new UnauthorizedError(reason);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(messageFrom(body, res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const body = (value: unknown) => (value === undefined ? undefined : JSON.stringify(value));

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: body(data) }),
  patch: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PATCH', body: body(data) }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PUT', body: body(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Multipart upload — used by the file pickers on the project and plot forms. */
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

/** Builds a `?a=1&b=2` query string, skipping undefined/null/empty values. */
export function toQueryString(params: Record<string, unknown>): string {
  const usable = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (usable.length === 0) return '';
  return `?${new URLSearchParams(usable.map(([k, v]) => [k, String(v)])).toString()}`;
}

/**
 * Uploads files and returns their stored paths. Every image/PDF picker in the admin panel
 * routes through here, so none of them needs its own multipart handling.
 */
export async function uploadFiles(files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const { urls } = await api.upload<{ urls: string[] }>('/uploads', form);
  return urls;
}

export const SESSION_STORAGE_KEY = SESSION_KEY;
