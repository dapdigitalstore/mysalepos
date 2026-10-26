import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { SaleForm } from '../../../_components/sale-form';

/** Edit a sale, draft or quotation. Sales made on the POS screen are handed over to the POS (see SaleForm). */
export default function EditSalePage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) notFound();
  return <SaleForm saleId={n} />;
}
