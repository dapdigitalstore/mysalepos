import { toQueryString } from '@/lib/client-api';

/**
 * Like `api()` from @/lib/client-api, but keeps the machine readable `code` of business-rule errors
 * (REGISTER_NOT_OPEN, CREDIT_LIMIT_EXCEEDED, PURCHASE_SELL_MISMATCH, ... see docs/SALES-API.md section 8).
 */
export class SaleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly messages: string[],
    public readonly code?: string,
  ) {
    super(messages[0] ?? `Request failed (${status})`);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export async function saleApi<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const res = await fetch(`/api/proxy${path}${toQueryString(opts.query)}`, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/api/session/logout';
    throw new SaleApiError(401, ['Session expired']);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const body = json as { message?: string | string[]; code?: string } | null;
    const m = body?.message;
    throw new SaleApiError(res.status, Array.isArray(m) ? m : m ? [m] : [], body?.code);
  }
  return json as T;
}
