import { setRequestLocale } from 'next-intl/server';
import { TaxesManager } from './taxes-manager';

export default function TaxesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <TaxesManager />;
}
