import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

function clear(req: NextRequest) {
  const locale = /^\/(en|si)(\/|$)/.exec(req.headers.get('referer') ? new URL(req.headers.get('referer') as string).pathname : '')?.[1] ?? 'en';
  const out = NextResponse.redirect(new URL(`/${locale}/login`, req.url), 303);
  out.cookies.delete(ACCESS_COOKIE);
  out.cookies.delete(REFRESH_COOKIE);
  return out;
}

export const GET = clear;
export const POST = clear;
