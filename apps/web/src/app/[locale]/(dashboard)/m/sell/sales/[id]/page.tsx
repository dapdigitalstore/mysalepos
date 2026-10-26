import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SaleDetailView } from './sale-detail';

export default function SaleDetailPage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) notFound();
  return <SaleDetailView id={n} />;
}
