import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { PrintFormat } from './print-types';
import { SalePrintView } from './sale-print';

/** `/m/sell/sales/<id>/print?format=receipt|invoice&auto=1` */
export default function SalePrintPage({
  params: { locale, id },
  searchParams,
}: {
  params: { locale: string; id: string };
  searchParams: { format?: string; auto?: string };
}) {
  setRequestLocale(locale);
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) notFound();
  const format: PrintFormat | null = searchParams.format === 'receipt' || searchParams.format === 'invoice' ? searchParams.format : null;
  return <SalePrintView id={n} format={format} autoPrint={searchParams.auto === '1'} />;
}
