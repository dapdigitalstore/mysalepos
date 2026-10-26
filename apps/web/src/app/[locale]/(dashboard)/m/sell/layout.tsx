import { setRequestLocale } from 'next-intl/server';
import { SellTabs } from './sell-tabs';

export default function SellLayout({ children, params: { locale } }: { children: React.ReactNode; params: { locale: string } }) {
  setRequestLocale(locale);
  return (
    <div>
      <SellTabs />
      {children}
    </div>
  );
}
