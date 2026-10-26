import { setRequestLocale } from 'next-intl/server';
import { ContactsTabs } from './contacts-tabs';

export default function ContactsLayout({ children, params: { locale } }: { children: React.ReactNode; params: { locale: string } }) {
  setRequestLocale(locale);
  return (
    <div>
      <ContactsTabs />
      {children}
    </div>
  );
}
