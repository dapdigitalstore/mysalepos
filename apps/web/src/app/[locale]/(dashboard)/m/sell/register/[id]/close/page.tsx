import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { CloseRegisterView } from '../../close-register-view';

export default function CloseRegisterPage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) notFound();
  return <CloseRegisterView id={n} />;
}
