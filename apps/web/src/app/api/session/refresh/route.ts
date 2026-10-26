import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { ACCESS_COOKIE, ACCESS_MAX_AGE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions, safeNext } from '@/lib/session';

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get('next'), '/');
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  const toLogin = () => {
    const out = NextResponse.redirect(new URL('/en/login', req.url));
    out.cookies.delete(ACCESS_COOKIE);
    out.cookies.delete(REFRESH_COOKIE);
    return out;
  };
  if (!refreshToken) return toLogin();

  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) return toLogin();
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    const out = NextResponse.redirect(new URL(next, req.url));
    out.cookies.set(ACCESS_COOKIE, data.accessToken, cookieOptions(ACCESS_MAX_AGE));
    out.cookies.set(REFRESH_COOKIE, data.refreshToken, cookieOptions(REFRESH_MAX_AGE));
    return out;
  } catch {
    return toLogin();
  }
}
