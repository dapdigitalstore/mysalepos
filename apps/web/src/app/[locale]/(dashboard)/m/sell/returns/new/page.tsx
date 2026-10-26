import { setRequestLocale } from 'next-intl/server';
import { NewReturn } from '../new-return';

/** `?saleId=<id>` opens the form of that sale directly (also used to edit the sale's existing return). */
export default function NewSellReturnPage({ params: { locale }, searchParams }: { params: { locale: string }; searchParams: { saleId?: string } }) {
  setRequestLocale(locale);
  const n = Number(searchParams.saleId);
  return <NewReturn saleId={Number.isInteger(n) && n > 0 ? n : null} />;
}
