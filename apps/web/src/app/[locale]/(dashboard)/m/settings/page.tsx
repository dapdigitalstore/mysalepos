import { redirect } from '@/i18n/routing';

export default function SettingsIndex({ params: { locale } }: { params: { locale: string } }) {
  redirect({ href: '/m/settings/business', locale });
}
