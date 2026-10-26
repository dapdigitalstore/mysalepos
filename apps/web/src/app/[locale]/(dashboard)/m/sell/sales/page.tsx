import { setRequestLocale } from 'next-intl/server';
import { SalesManager } from './sales-manager';

export default function SalesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <SalesManager />;
}
