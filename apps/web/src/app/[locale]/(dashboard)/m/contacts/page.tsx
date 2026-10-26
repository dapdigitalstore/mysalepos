import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/routing';
import { apiGet, type MeResponse } from '@/lib/api';
import { can } from '@/lib/can';

/** /m/contacts has no page of its own: go to the first tab this user may see. */
export default async function ContactsIndex({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const { user } = await apiGet<MeResponse>('/auth/me');
  const canSee = (...p: string[]) => p.some((x) => can(user, x));
  const href = canSee('supplier.view', 'supplier.view_own')
    ? '/m/contacts/suppliers'
    : canSee('customer.view', 'customer.view_own')
      ? '/m/contacts/customers'
      : canSee('customer.view')
        ? '/m/contacts/groups'
        : '/m/contacts/suppliers';
  redirect({ href, locale });
}
