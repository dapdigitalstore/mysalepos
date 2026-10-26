import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/routing';
import { apiGet, type MeResponse } from '@/lib/api';
import { can } from '@/lib/can';

/** /m/users has no page of its own: go to the first tab this user may see (everyone may see their profile). */
export default async function UsersIndex({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const { user } = await apiGet<MeResponse>('/auth/me');
  const canSee = (...p: string[]) => p.some((x) => can(user, x));
  const href = canSee('user.view', 'user.create') ? '/m/users/list' : canSee('roles.view') ? '/m/users/roles' : '/m/users/profile';
  redirect({ href, locale });
}
