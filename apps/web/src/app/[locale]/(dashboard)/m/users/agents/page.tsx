import { setRequestLocale } from 'next-intl/server';
import { AgentsManager } from './agents-manager';

export default function AgentsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <AgentsManager />;
}
