import { useTranslations } from 'next-intl';
import { SubNav } from '@/components/sub-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('settings');
  return (
    <div className="mx-auto max-w-6xl">
      <SubNav
        items={[
          { href: '/m/settings/business', label: t('business') },
          { href: '/m/settings/locations', label: t('locations') },
          { href: '/m/settings/taxes', label: t('taxes') },
        ]}
      />
      {children}
    </div>
  );
}
