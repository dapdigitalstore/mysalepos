import { setRequestLocale } from 'next-intl/server';
import { UsersTabs } from './users-tabs';

export default function UsersLayout({ children, params: { locale } }: { children: React.ReactNode; params: { locale: string } }) {
  setRequestLocale(locale);
  return (
    <div className="mx-auto max-w-6xl">
      <UsersTabs />
      {children}
    </div>
  );
}
