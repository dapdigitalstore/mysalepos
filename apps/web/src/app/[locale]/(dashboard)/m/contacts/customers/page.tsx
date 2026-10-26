import { setRequestLocale } from 'next-intl/server';
import { ContactsManager } from '../contacts-manager';

export default function CustomersPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <ContactsManager side="customer" />;
}
