import { setRequestLocale } from 'next-intl/server';
import { ProfileManager } from './profile-manager';

export default function ProfilePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <ProfileManager />;
}
