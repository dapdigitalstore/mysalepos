import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ReturnDetailView } from '../return-detail';

export default function SellReturnDetailPage({
  params: { locale, id },
  searchParams,
}: {
  params: { locale: string; id: string };
  searchParams: { print?: string };
}) {
  setRequestLocale(locale);
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) notFound();
  return <ReturnDetailView id={n} autoPrint={searchParams.print === '1'} />;
}
