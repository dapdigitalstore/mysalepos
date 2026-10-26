import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { ACCESS_COOKIE, ACCESS_MAX_AGE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions } from '@/lib/session';

/**
 * Browser -> Next -> NestJS bridge. Client components call /api/proxy/<api path>; this handler adds the
 * Bearer token from the httpOnly cookie (so the token never reaches JavaScript) and transparently renews
 * an expired access token with the refresh token.
 */
async function forward(req: NextRequest, { params }: { params: { path: string[] } }) {
  // CSRF guard for state-changing calls: the Origin (when sent) must be this site.
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== req.headers.get('host')) {
      return NextResponse.json({ message: 'Cross-site request blocked' }, { status: 403 });
    }
  }

  const target = `${API_URL}/api/${params.path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  const contentType = req.headers.get('content-type');

  const call = (token: string) =>
    fetch(target, {
      method: req.method,
      headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
      body,
      cache: 'no-store',
    });

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let renewed: { accessToken: string; refreshToken: string } | null = null;
  let res: Response | null = access ? await call(access) : null;

  if ((!res || res.status === 401) && refresh) {
    const r = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: 'no-store',
    });
    if (r.ok) {
      renewed = (await r.json()) as { accessToken: string; refreshToken: string };
      res = await call(renewed.accessToken);
    }
  }
  if (!res) return NextResponse.json({ message: 'Not signed in' }, { status: 401 });

  const out = new NextResponse(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/json',
      ...(res.headers.get('content-disposition') ? { 'Content-Disposition': res.headers.get('content-disposition') as string } : {}),
    },
  });
  if (renewed) {
    out.cookies.set(ACCESS_COOKIE, renewed.accessToken, cookieOptions(ACCESS_MAX_AGE));
    out.cookies.set(REFRESH_COOKIE, renewed.refreshToken, cookieOptions(REFRESH_MAX_AGE));
  }
  return out;
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
