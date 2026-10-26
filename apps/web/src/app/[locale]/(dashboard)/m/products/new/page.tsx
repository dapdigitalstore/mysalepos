import { setRequestLocale } from 'next-intl/server';
import { ProductForm } from '../product-form';

export default function NewProductPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <ProductForm />;
}
