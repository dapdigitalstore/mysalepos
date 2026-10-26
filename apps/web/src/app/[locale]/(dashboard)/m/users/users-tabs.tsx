'use client';

import { useTranslations } from 'next-intl';
import { useCan } from '@/components/providers';
import { SubNav } from '@/components/sub-nav';

export function UsersTabs() {
  const t = useTranslations('users');
  const can = useCan();
  return (
    <SubNav
      items={[
        { href: '/m/users/list', label: t('tabUsers'), visible: can('user.view', 'user.create') },
        { href: '/m/users/roles', label: t('tabRoles'), visible: can('roles.view') },
        { href: '/m/users/agents', label: t('tabAgents'), visible: can('user.view', 'user.create') },
        { href: '/m/users/profile', label: t('tabProfile') },
      ]}
    />
  );
}
