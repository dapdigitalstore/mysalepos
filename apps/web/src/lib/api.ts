import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE } from './session';

export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4400';

export interface AuthUser {
  id: number;
  businessId: number;
  username: string;
  firstName: string;
  lastName: string;
  language: string;
  isAdmin: boolean;
  isSuperadmin: boolean;
  permissions: string[];
}

export interface ModuleInfo {
  id: string;
  kind: 'core' | 'addon';
  icon: string;
  name: { en: string; si: string };
  phase: number;
  status: 'done' | 'in-progress' | 'planned';
  features: string[];
}

export interface MeResponse {
  user: AuthUser;
  business: { id: number; name: string; logo: string | null; time_zone: string; currency_id: number } | null;
}

export interface DashboardSummary {
  products: number;
  contacts: number;
  salesThisMonth: { count: number; total: string };
  purchasesThisMonth: { count: number; total: string };
}

/** Server-side call to the NestJS API using the session cookie. A 401 sends the user back through login. */
export async function apiGet<T>(path: string): Promise<T> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/api/session/logout');
  const res = await fetch(`${API_URL}/api${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (res.status === 401) redirect('/api/session/logout');
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}
