import { setRequestLocale } from 'next-intl/server';
import { LocationsManager } from './locations-manager';

export default function LocationsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <LocationsManager />;
}
