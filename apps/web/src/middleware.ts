import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './lib/session';

const intl = createMiddleware(routing);
const LOGIN_PATH = /^\/(en|si)\/login\/?$/;

export default function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isLogin = LOGIN_PATH.test(pathname);
  const hasAccess = req.cookies.has(ACCESS_COOKIE);
  const hasRefresh = req.cookies.has(REFRESH_COOKIE);

  // Access token expired but a refresh token exists: renew it, then come back to the same page.
  if (!isLogin && !hasAccess && hasRefresh && /^\/(en|si)(\/|$)/.test(pathname)) {
    const url = new URL('/api/session/refresh', req.url);
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  // Not signed in at all: send to the login page of the current locale.
  const localeMatch = /^\/(en|si)(\/|$)/.exec(pathname);
  if (localeMatch && !isLogin && !hasAccess && !hasRefresh) {
    return NextResponse.redirect(new URL(`/${localeMatch[1]}/login`, req.url));
  }
  // Already signed in: skip the login page.
  if (isLogin && hasAccess) {
    return NextResponse.redirect(new URL(pathname.replace(/\/login\/?$/, ''), req.url));
  }
  return intl(req);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
