import { setRequestLocale } from 'next-intl/server';
import { WarrantiesManager } from './warranties-manager';

export default function WarrantiesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <WarrantiesManager />;
}
