import { setRequestLocale } from 'next-intl/server';
import { SaleForm } from '../_components/sale-form';

/** Add sale (Laravel "Add sale"): a full form for a final sale, draft, quotation or proforma. */
export default function NewSalePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <SaleForm />;
}
