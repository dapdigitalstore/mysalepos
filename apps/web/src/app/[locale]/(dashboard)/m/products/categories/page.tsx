import { setRequestLocale } from 'next-intl/server';
import { CategoriesManager } from './categories-manager';

export default function CategoriesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <CategoriesManager />;
}
