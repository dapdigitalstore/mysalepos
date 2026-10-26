import { setRequestLocale } from 'next-intl/server';
import { ProductsManager } from './products-manager';

export default function ProductsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <ProductsManager />;
}
