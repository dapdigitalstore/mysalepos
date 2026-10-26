/** Browser-side helper for calling the NestJS API through the /api/proxy bridge. */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly messages: string[]) {
    super(messages[0] ?? `Request failed (${status})`);
  }
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function toQueryString(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const res = await fetch(`/api/proxy${path}${toQueryString(opts.query)}`, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/api/session/logout';
    throw new ApiError(401, ['Session expired']);
  }
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const m = (json as { message?: string | string[] } | null)?.message;
    throw new ApiError(res.status, Array.isArray(m) ? m : m ? [m] : []);
  }
  return json as T;
}
