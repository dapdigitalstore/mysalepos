import { setRequestLocale } from 'next-intl/server';
import { VariationTemplatesManager } from './variation-templates-manager';

export default function VariationTemplatesPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <VariationTemplatesManager />;
}
