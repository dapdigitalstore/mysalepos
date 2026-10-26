import { setRequestLocale } from 'next-intl/server';
import { BusinessSettingsForm } from './business-settings-form';

export default function BusinessSettingsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <BusinessSettingsForm />;
}
