import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/routing';
import { apiGet, type MeResponse } from '@/lib/api';
import { can } from '@/lib/can';

/** /m/sell has no page of its own: go to the first tab this user may see. */
export default async function SellIndex({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const { user } = await apiGet<MeResponse>('/auth/me');
  const canSee = (...p: string[]) => p.some((x) => can(user, x));
  const href = canSee('sell.create')
    ? '/m/sell/pos'
    : canSee('sell.view', 'direct_sell.access', 'view_own_sell_only')
      ? '/m/sell/sales'
      : canSee('list_drafts')
        ? '/m/sell/drafts'
        : '/m/sell/sales';
  redirect({ href, locale });
}
