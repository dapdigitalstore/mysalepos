import { setRequestLocale } from 'next-intl/server';
import { RolesManager } from './roles-manager';

export default function RolesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <RolesManager />;
}
