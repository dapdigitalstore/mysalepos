import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { OpeningStockEditor } from '../../opening-stock-editor';

export default function OpeningStockPage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId < 1) notFound();
  return <OpeningStockEditor productId={productId} />;
}
