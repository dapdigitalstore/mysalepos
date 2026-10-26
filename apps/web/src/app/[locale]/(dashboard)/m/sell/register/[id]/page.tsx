import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { RegisterDetailsView } from '../register-details-view';

export default function RegisterDetailsPage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) notFound();
  return <RegisterDetailsView id={n} />;
}
