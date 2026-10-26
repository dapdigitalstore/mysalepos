import { setRequestLocale } from 'next-intl/server';
import { ProductsTabs } from './products-tabs';

export default function ProductsLayout({ children, params: { locale } }: { children: React.ReactNode; params: { locale: string } }) {
  setRequestLocale(locale);
  return (
    <>
      <ProductsTabs />
      {children}
    </>
  );
}
