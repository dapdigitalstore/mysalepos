import { setRequestLocale } from 'next-intl/server';
import { RegisterOverview } from './register-overview';

export default function RegisterPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <RegisterOverview />;
}
