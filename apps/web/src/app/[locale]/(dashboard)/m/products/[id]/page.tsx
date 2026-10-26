import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ProductDetailView } from '../product-detail';

export default function ProductPage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId < 1) notFound();
  return <ProductDetailView productId={productId} />;
}
