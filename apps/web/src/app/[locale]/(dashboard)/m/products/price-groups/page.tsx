import { setRequestLocale } from 'next-intl/server';
import { SellingPriceGroupsManager } from './selling-price-groups-manager';

export default function SellingPriceGroupsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <SellingPriceGroupsManager />;
}
