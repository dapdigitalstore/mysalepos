import { setRequestLocale } from 'next-intl/server';
import { CustomerGroupsManager } from './customer-groups-manager';

export default function CustomerGroupsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <CustomerGroupsManager />;
}
