import { setRequestLocale } from 'next-intl/server';
import { ReturnsManager } from './returns-manager';

export default function SellReturnsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <ReturnsManager />;
}
