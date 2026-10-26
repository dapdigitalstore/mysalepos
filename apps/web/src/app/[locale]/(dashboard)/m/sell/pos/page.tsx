import { setRequestLocale } from 'next-intl/server';
import { PosEntry } from './pos-entry';

/** Point of sale. `?sale=<id>` loads a POS sale, draft or quotation for editing. */
export default function PosPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <PosEntry />;
}
