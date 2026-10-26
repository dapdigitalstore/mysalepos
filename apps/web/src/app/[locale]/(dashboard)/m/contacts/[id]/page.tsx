import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ContactDetailView } from '../contact-detail';

export default function ContactDetailPage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) notFound();
  return <ContactDetailView id={n} />;
}
