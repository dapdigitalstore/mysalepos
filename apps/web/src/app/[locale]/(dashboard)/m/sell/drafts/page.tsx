import { setRequestLocale } from 'next-intl/server';
import { DraftsList } from '../sales/_lib/drafts-list';

export default function DraftsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <DraftsList mode="drafts" />;
}
