import { setRequestLocale } from 'next-intl/server';
import { BrandsManager } from './brands-manager';

export default function BrandsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <BrandsManager />;
}
