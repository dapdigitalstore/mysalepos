import { setRequestLocale } from 'next-intl/server';
import { UsersManager } from './users-manager';

export default function UsersPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <UsersManager />;
}
