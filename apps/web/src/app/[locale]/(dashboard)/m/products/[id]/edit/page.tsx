import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ProductForm } from '../../product-form';

export default function EditProductPage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId < 1) notFound();
  return <ProductForm productId={productId} />;
}
