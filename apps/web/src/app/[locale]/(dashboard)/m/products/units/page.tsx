import { setRequestLocale } from 'next-intl/server';
import { UnitsManager } from './units-manager';

export default function UnitsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <UnitsManager />;
}
