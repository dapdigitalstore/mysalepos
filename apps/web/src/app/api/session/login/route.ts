import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { ACCESS_COOKIE, ACCESS_MAX_AGE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions } from '@/lib/session';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const forwardedFor = req.headers.get('x-forwarded-for') ?? '';

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
      body: JSON.stringify({ username: body.username, password: body.password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'generic' }, { status: 502 });
  }
  if (res.status === 429) return NextResponse.json({ error: 'tooMany' }, { status: 429 });
  if (res.status === 401 || res.status === 400) return NextResponse.json({ error: 'invalid' }, { status: 401 });
  if (!res.ok) return NextResponse.json({ error: 'generic' }, { status: 502 });

  const data = (await res.json()) as { accessToken: string; refreshToken: string; user: { language: string } };
  const out = NextResponse.json({ ok: true, language: data.user.language });
  out.cookies.set(ACCESS_COOKIE, data.accessToken, cookieOptions(ACCESS_MAX_AGE));
  out.cookies.set(REFRESH_COOKIE, data.refreshToken, cookieOptions(REFRESH_MAX_AGE));
  return out;
}
